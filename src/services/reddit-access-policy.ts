import type {
  RedditAccessFailureKind,
  RedditAccessObservation,
  RedditAccessState,
  RedditRequestReservation,
} from '../storage/reddit-access-repository.js';
import {
  type PublicConversationFetchResult,
  type PublicDiscoveryFetchResult,
  type RedditResponseMetadata,
  RedditTransportError,
} from './public-shadow-reddit-transport.js';

const DEFAULT_RATE_LIMIT_BACKOFF_MS = 15 * 60 * 1_000;
const EMPTY_QUOTA_BACKOFF_MS = 5 * 60 * 1_000;
export const PUBLIC_SHADOW_RSS_CADENCE_MS = 60_000;

interface RedditAccessStateRepository {
  reserveAttempt(
    attemptedAt: string,
    blockedUntil: string,
  ): Promise<RedditRequestReservation>;
  recordSuccess(
    attemptedAt: string,
    observation: RedditAccessObservation,
  ): Promise<RedditAccessState>;
  recordFailure(
    kind: RedditAccessFailureKind,
    attemptedAt: string,
    observation: RedditAccessObservation,
  ): Promise<RedditAccessState>;
}

interface DiscoveryTransport {
  fetchCandidates(
    subreddit: string,
    query: string,
  ): Promise<PublicDiscoveryFetchResult>;
}

interface ConversationTransport {
  fetchConversation(
    threadExternalId: string,
  ): Promise<PublicConversationFetchResult>;
}

export class RedditAccessPausedError extends Error {
  constructor(
    readonly reason: 'backoff' | 'disabled',
    readonly resumeAt: string | null,
  ) {
    super(`Reddit access paused: ${reason}`);
    this.name = 'RedditAccessPausedError';
  }
}

/**
 * Applies the persisted public-shadow safety policy before and after every
 * Reddit request, including requests made later in the same invocation.
 */
export class BackoffAwarePublicShadowRedditTransport
  implements DiscoveryTransport, ConversationTransport
{
  constructor(
    private readonly discoveryTransport: DiscoveryTransport,
    private readonly conversationTransport: ConversationTransport,
    private readonly accessRepository: RedditAccessStateRepository,
    private readonly now: () => Date,
  ) {}

  async fetchCandidates(
    subreddit: string,
    query: string,
  ): Promise<PublicDiscoveryFetchResult> {
    return this.run(() =>
      this.discoveryTransport.fetchCandidates(subreddit, query),
    );
  }

  async fetchConversation(
    threadExternalId: string,
  ): Promise<PublicConversationFetchResult> {
    return this.run(() =>
      this.conversationTransport.fetchConversation(threadExternalId),
    );
  }

  private async run<
    Result extends {
      metadata: RedditResponseMetadata;
    },
  >(request: () => Promise<Result>): Promise<Result> {
    const attemptedAt = readCurrentTime(this.now);
    const reservation = await this.accessRepository.reserveAttempt(
      attemptedAt.toISOString(),
      addMilliseconds(attemptedAt, PUBLIC_SHADOW_RSS_CADENCE_MS),
    );
    if (reservation.kind === 'unavailable') {
      throw pausedError(reservation.state, attemptedAt);
    }

    try {
      const result = await request();
      await this.accessRepository.recordSuccess(
        attemptedAt.toISOString(),
        observationFromMetadata(result.metadata, attemptedAt, false),
      );
      return result;
    } catch (error) {
      if (!(error instanceof RedditTransportError)) throw error;
      await this.accessRepository.recordFailure(
        failureKind(error.category),
        attemptedAt.toISOString(),
        observationFromMetadata(
          error.metadata,
          attemptedAt,
          error.category === 'rate_limited',
        ),
      );
      throw error;
    }
  }
}

function pausedError(
  state: RedditAccessState,
  now: Date,
): RedditAccessPausedError {
  if (state.disabledReason !== null) {
    return new RedditAccessPausedError('disabled', null);
  }
  if (
    state.blockedUntil !== null &&
    Date.parse(state.blockedUntil) > now.valueOf()
  ) {
    return new RedditAccessPausedError('backoff', state.blockedUntil);
  }
  throw new TypeError('Reddit request reservation became unavailable');
}

function observationFromMetadata(
  metadata: RedditResponseMetadata | null,
  attemptedAt: Date,
  applyDefaultRateLimitBackoff: boolean,
): RedditAccessObservation {
  const retryAfterAt = metadata?.retryAfterAt ?? null;
  const quotaResetAt =
    metadata?.rateLimitRemaining === 0
      ? (metadata.rateLimitResetAt ??
        addMilliseconds(attemptedAt, EMPTY_QUOTA_BACKOFF_MS))
      : null;
  const defaultBackoffAt =
    applyDefaultRateLimitBackoff &&
    retryAfterAt === null &&
    quotaResetAt === null
      ? addMilliseconds(attemptedAt, DEFAULT_RATE_LIMIT_BACKOFF_MS)
      : null;
  return {
    blockedUntil: latestTimestamp([
      retryAfterAt,
      quotaResetAt,
      defaultBackoffAt,
    ]),
    rateLimitRemaining: metadata?.rateLimitRemaining ?? null,
    rateLimitResetAt: metadata?.rateLimitResetAt ?? null,
  };
}

function failureKind(
  category: RedditTransportError['category'],
): RedditAccessFailureKind {
  if (category === 'authentication' || category === 'blocked') return category;
  if (category === 'invalid_content_type') return 'invalid_content_type';
  if (category === 'rate_limited') return 'rate_limited';
  if (category === 'malformed_response' || category === 'response_too_large') {
    return 'shape';
  }
  return 'transient';
}

function latestTimestamp(values: Array<string | null>): string | null {
  let latest: string | null = null;
  for (const value of values) {
    if (value !== null && (latest === null || value > latest)) latest = value;
  }
  return latest;
}

function addMilliseconds(now: Date, milliseconds: number): string {
  return new Date(now.valueOf() + milliseconds).toISOString();
}

function readCurrentTime(now: () => Date): Date {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) {
    throw new TypeError('Invalid current time');
  }
  return value;
}
