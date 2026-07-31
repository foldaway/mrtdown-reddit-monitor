const TRANSPORT = 'public-shadow';

export type RedditAccessDisabledReason =
  | 'authentication'
  | 'blocked'
  | 'invalid_content_type'
  | 'repeated_rate_limited'
  | 'sustained_shape_failure';

export type RedditAccessFailureKind =
  | 'authentication'
  | 'blocked'
  | 'invalid_content_type'
  | 'rate_limited'
  | 'shape'
  | 'transient';

export interface RedditAccessObservation {
  blockedUntil: string | null;
  rateLimitRemaining: number | null;
  rateLimitResetAt: string | null;
}

export interface RedditAccessState {
  blockedUntil: string | null;
  disabledReason: RedditAccessDisabledReason | null;
  consecutiveRateLimits: number;
  consecutiveShapeFailures: number;
  lastAttemptAt: string;
  lastSuccessAt: string | null;
  rateLimitRemaining: number | null;
  rateLimitResetAt: string | null;
}

export type RedditRequestReservation =
  | { kind: 'reserved'; state: RedditAccessState }
  | { kind: 'unavailable'; state: RedditAccessState };

export class RedditAccessStorageError extends Error {
  constructor(readonly code: 'corrupt_row' | 'read_failed' | 'write_failed') {
    super(`Reddit access storage failed: ${code}`);
    this.name = 'RedditAccessStorageError';
  }
}

/**
 * Stores only public-shadow access policy state. Reddit response content and
 * headers other than normalized rate-limit timestamps never reach D1.
 */
export class RedditAccessRepository {
  constructor(private readonly database: D1Database) {}

  async getState(): Promise<RedditAccessState | null> {
    let row: Record<string, unknown> | null;
    try {
      row = await this.database
        .prepare(
          `SELECT blocked_until, disabled_reason, consecutive_rate_limits,
                  consecutive_shape_failures, last_attempt_at, last_success_at,
                  rate_limit_remaining, rate_limit_reset_at
           FROM reddit_transport_state
           WHERE transport = ?`,
        )
        .bind(TRANSPORT)
        .first<Record<string, unknown>>();
    } catch {
      throw new RedditAccessStorageError('read_failed');
    }
    return row === null ? null : parseState(row);
  }

  /**
   * Atomically records an outbound RSS attempt before it starts. The existing
   * `blocked_until` field is the single durable gate for both the fixed
   * cadence and any longer Reddit-directed backoff.
   */
  async reserveAttempt(
    attemptedAt: string,
    blockedUntil: string,
  ): Promise<RedditRequestReservation> {
    const normalizedAttemptedAt = normalizeTimestamp(attemptedAt);
    const normalizedBlockedUntil = normalizeTimestamp(blockedUntil);
    if (normalizedBlockedUntil <= normalizedAttemptedAt) {
      throw new TypeError('Reddit request reservation must be in the future');
    }

    let row: Record<string, unknown> | null;
    try {
      row = await this.database
        .prepare(
          `INSERT INTO reddit_transport_state (
             transport, blocked_until, consecutive_rate_limits,
             consecutive_shape_failures, last_attempt_at
           ) VALUES (?, ?, 0, 0, ?)
           ON CONFLICT(transport) DO UPDATE SET
             blocked_until = excluded.blocked_until,
             last_attempt_at = excluded.last_attempt_at
           WHERE reddit_transport_state.disabled_reason IS NULL
             AND (
               reddit_transport_state.blocked_until IS NULL
               OR reddit_transport_state.blocked_until <= excluded.last_attempt_at
             )
           RETURNING blocked_until, disabled_reason, consecutive_rate_limits,
                     consecutive_shape_failures, last_attempt_at, last_success_at,
                     rate_limit_remaining, rate_limit_reset_at`,
        )
        .bind(TRANSPORT, normalizedBlockedUntil, normalizedAttemptedAt)
        .first<Record<string, unknown>>();
    } catch {
      throw new RedditAccessStorageError('write_failed');
    }
    if (row !== null) return { kind: 'reserved', state: parseState(row) };

    const state = await this.getState();
    if (state === null) throw new RedditAccessStorageError('write_failed');
    return { kind: 'unavailable', state };
  }

  async recordSuccess(
    attemptedAt: string,
    observation: RedditAccessObservation,
  ): Promise<RedditAccessState> {
    const values = normalizeWrite(attemptedAt, observation);
    await this.run(
      this.database
        .prepare(
          `INSERT INTO reddit_transport_state (
             transport, blocked_until, consecutive_rate_limits,
             consecutive_shape_failures, last_attempt_at, last_success_at,
             rate_limit_remaining, rate_limit_reset_at
           ) VALUES (?, ?, 0, 0, ?, ?, ?, ?)
           ON CONFLICT(transport) DO UPDATE SET
             blocked_until = ${laterBlockedUntilSql()},
             consecutive_rate_limits = 0,
             consecutive_shape_failures = 0,
             last_attempt_at = excluded.last_attempt_at,
             last_success_at = excluded.last_success_at,
             rate_limit_remaining = excluded.rate_limit_remaining,
             rate_limit_reset_at = excluded.rate_limit_reset_at`,
        )
        .bind(
          TRANSPORT,
          values.blockedUntil,
          values.attemptedAt,
          values.attemptedAt,
          values.rateLimitRemaining,
          values.rateLimitResetAt,
        ),
    );
    return this.requireState();
  }

  async recordFailure(
    kind: RedditAccessFailureKind,
    attemptedAt: string,
    observation: RedditAccessObservation,
  ): Promise<RedditAccessState> {
    const values = normalizeWrite(attemptedAt, observation);
    if (kind === 'rate_limited') {
      await this.recordRateLimitFailure(values);
    } else if (kind === 'shape') {
      await this.recordShapeFailure(values);
    } else if (
      kind === 'authentication' ||
      kind === 'blocked' ||
      kind === 'invalid_content_type'
    ) {
      await this.recordTerminalFailure(kind, values);
    } else {
      await this.recordTransientFailure(values);
    }
    return this.requireState();
  }

  private async recordRateLimitFailure(values: NormalizedWrite) {
    await this.run(
      this.database
        .prepare(
          `INSERT INTO reddit_transport_state (
             transport, blocked_until, consecutive_rate_limits,
             consecutive_shape_failures, last_attempt_at,
             rate_limit_remaining, rate_limit_reset_at
           ) VALUES (?, ?, 1, 0, ?, ?, ?)
           ON CONFLICT(transport) DO UPDATE SET
             blocked_until = ${laterBlockedUntilSql()},
             disabled_reason = COALESCE(
               reddit_transport_state.disabled_reason,
               CASE
                 WHEN reddit_transport_state.consecutive_rate_limits >= 1
                   THEN 'repeated_rate_limited'
                 ELSE NULL
               END
             ),
             consecutive_rate_limits =
               reddit_transport_state.consecutive_rate_limits + 1,
             consecutive_shape_failures = 0,
             last_attempt_at = excluded.last_attempt_at,
             rate_limit_remaining = excluded.rate_limit_remaining,
             rate_limit_reset_at = excluded.rate_limit_reset_at`,
        )
        .bind(
          TRANSPORT,
          values.blockedUntil,
          values.attemptedAt,
          values.rateLimitRemaining,
          values.rateLimitResetAt,
        ),
    );
  }

  private async recordShapeFailure(values: NormalizedWrite) {
    await this.run(
      this.database
        .prepare(
          `INSERT INTO reddit_transport_state (
             transport, blocked_until, consecutive_rate_limits,
             consecutive_shape_failures, last_attempt_at,
             rate_limit_remaining, rate_limit_reset_at
           ) VALUES (?, ?, 0, 1, ?, ?, ?)
           ON CONFLICT(transport) DO UPDATE SET
             blocked_until = ${laterBlockedUntilSql()},
             disabled_reason = COALESCE(
               reddit_transport_state.disabled_reason,
               CASE
                 WHEN reddit_transport_state.consecutive_shape_failures >= 2
                   THEN 'sustained_shape_failure'
                 ELSE NULL
               END
             ),
             consecutive_rate_limits = 0,
             consecutive_shape_failures =
               reddit_transport_state.consecutive_shape_failures + 1,
             last_attempt_at = excluded.last_attempt_at,
             rate_limit_remaining = excluded.rate_limit_remaining,
             rate_limit_reset_at = excluded.rate_limit_reset_at`,
        )
        .bind(
          TRANSPORT,
          values.blockedUntil,
          values.attemptedAt,
          values.rateLimitRemaining,
          values.rateLimitResetAt,
        ),
    );
  }

  private async recordTerminalFailure(
    reason: Extract<
      RedditAccessFailureKind,
      'authentication' | 'blocked' | 'invalid_content_type'
    >,
    values: NormalizedWrite,
  ) {
    await this.run(
      this.database
        .prepare(
          `INSERT INTO reddit_transport_state (
             transport, blocked_until, disabled_reason,
             consecutive_rate_limits, consecutive_shape_failures,
             last_attempt_at, rate_limit_remaining, rate_limit_reset_at
           ) VALUES (?, ?, ?, 0, 0, ?, ?, ?)
           ON CONFLICT(transport) DO UPDATE SET
             blocked_until = ${laterBlockedUntilSql()},
             disabled_reason = COALESCE(
               reddit_transport_state.disabled_reason,
               excluded.disabled_reason
             ),
             consecutive_rate_limits = 0,
             consecutive_shape_failures = 0,
             last_attempt_at = excluded.last_attempt_at,
             rate_limit_remaining = excluded.rate_limit_remaining,
             rate_limit_reset_at = excluded.rate_limit_reset_at`,
        )
        .bind(
          TRANSPORT,
          values.blockedUntil,
          reason,
          values.attemptedAt,
          values.rateLimitRemaining,
          values.rateLimitResetAt,
        ),
    );
  }

  private async recordTransientFailure(values: NormalizedWrite) {
    await this.run(
      this.database
        .prepare(
          `INSERT INTO reddit_transport_state (
             transport, blocked_until, consecutive_rate_limits,
             consecutive_shape_failures, last_attempt_at,
             rate_limit_remaining, rate_limit_reset_at
           ) VALUES (?, ?, 0, 0, ?, ?, ?)
           ON CONFLICT(transport) DO UPDATE SET
             blocked_until = ${laterBlockedUntilSql()},
             consecutive_rate_limits = 0,
             consecutive_shape_failures = 0,
             last_attempt_at = excluded.last_attempt_at,
             rate_limit_remaining = excluded.rate_limit_remaining,
             rate_limit_reset_at = excluded.rate_limit_reset_at`,
        )
        .bind(
          TRANSPORT,
          values.blockedUntil,
          values.attemptedAt,
          values.rateLimitRemaining,
          values.rateLimitResetAt,
        ),
    );
  }

  private async requireState(): Promise<RedditAccessState> {
    const state = await this.getState();
    if (state === null) throw new RedditAccessStorageError('write_failed');
    return state;
  }

  private async run(statement: D1PreparedStatement): Promise<void> {
    try {
      await statement.run();
    } catch {
      throw new RedditAccessStorageError('write_failed');
    }
  }
}

interface NormalizedWrite extends RedditAccessObservation {
  attemptedAt: string;
}

function normalizeWrite(
  attemptedAt: string,
  observation: RedditAccessObservation,
): NormalizedWrite {
  if (
    observation.rateLimitRemaining !== null &&
    (!Number.isFinite(observation.rateLimitRemaining) ||
      observation.rateLimitRemaining < 0)
  ) {
    throw new TypeError('Invalid Reddit rate-limit remaining value');
  }
  return {
    attemptedAt: normalizeTimestamp(attemptedAt),
    blockedUntil: normalizeNullableTimestamp(observation.blockedUntil),
    rateLimitRemaining: observation.rateLimitRemaining,
    rateLimitResetAt: normalizeNullableTimestamp(observation.rateLimitResetAt),
  };
}

function laterBlockedUntilSql(): string {
  return `CASE
    WHEN excluded.blocked_until IS NULL
      THEN reddit_transport_state.blocked_until
    WHEN reddit_transport_state.blocked_until IS NULL
      OR reddit_transport_state.blocked_until < excluded.blocked_until
      THEN excluded.blocked_until
    ELSE reddit_transport_state.blocked_until
  END`;
}

function parseState(row: Record<string, unknown>): RedditAccessState {
  try {
    const disabledReason = nullableEnum(row.disabled_reason, [
      'authentication',
      'blocked',
      'invalid_content_type',
      'repeated_rate_limited',
      'sustained_shape_failure',
    ] as const);
    return {
      blockedUntil: parseNullableTimestamp(row.blocked_until),
      disabledReason,
      consecutiveRateLimits: nonNegativeInteger(row.consecutive_rate_limits),
      consecutiveShapeFailures: nonNegativeInteger(
        row.consecutive_shape_failures,
      ),
      lastAttemptAt: parseTimestamp(row.last_attempt_at),
      lastSuccessAt: parseNullableTimestamp(row.last_success_at),
      rateLimitRemaining: nullableNonNegativeNumber(row.rate_limit_remaining),
      rateLimitResetAt: parseNullableTimestamp(row.rate_limit_reset_at),
    };
  } catch (error) {
    if (error instanceof RedditAccessStorageError) throw error;
    throw new RedditAccessStorageError('corrupt_row');
  }
}

function normalizeNullableTimestamp(value: string | null): string | null {
  return value === null ? null : normalizeTimestamp(value);
}

function normalizeTimestamp(value: string): string {
  if (
    typeof value !== 'string' ||
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new TypeError('Invalid timestamp');
  }
  return new Date(value).toISOString();
}

function parseTimestamp(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Invalid timestamp');
  return normalizeTimestamp(value);
}

function parseNullableTimestamp(value: unknown): string | null {
  if (value === null) return null;
  return parseTimestamp(value);
}

function nullableEnum<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): Values[number] | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !values.includes(value)) {
    throw new TypeError('Invalid enum');
  }
  return value as Values[number];
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new TypeError('Invalid integer');
  }
  return value;
}

function nullableNonNegativeNumber(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError('Invalid number');
  }
  return value;
}
