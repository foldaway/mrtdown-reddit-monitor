import {
  parseParserDecision,
  type CrowdReport,
} from '../contracts/crowd-report.js';
import type { RedditSourceObject } from '../contracts/reddit-source.js';
import {
  parseCrowdReportDeliveryRequest,
  parseSiteAcceptedResponse,
  type CrowdReportDeliveryRequest,
  type SiteAcceptedResponse,
} from '../contracts/site.js';

const CONTENT_VERSION_PATTERN = /^[a-f0-9]{64}$/;
const FULLNAME_PATTERN = /^(?:t1|t3)_[a-z0-9]+$/;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9._~-]+$/;
const SUBREDDIT_PATTERN = /^[A-Za-z0-9_]{1,21}$/;
const REDDIT_ORIGINS = new Set([
  'https://reddit.com',
  'https://www.reddit.com',
]);

type EvaluationStatus = 'pending' | 'superseded' | 'irrelevant' | 'report';
type DeliveryStatus = 'none' | 'pending' | 'acknowledged';
type SelectionStatus = 'pending' | 'irrelevant' | 'selected';

export interface SourceVersionKey {
  sourceExternalId: string;
  contentVersion: string;
}

export interface StoredSourceVersion {
  source: RedditSourceObject;
  contentVersion: string;
  isCurrent: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  evaluationStatus: EvaluationStatus;
  evaluatedAt?: string;
  report?: CrowdReport;
  externalReportId?: string;
  deliveryStatus: DeliveryStatus;
  acknowledgement?: SiteAcceptedResponse & { acknowledgedAt: string };
}

export interface ThreadRecord {
  threadExternalId: string;
  subreddit: string;
  selectionStatus: SelectionStatus;
  workflowId?: string;
  workflowAssignedAt?: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export class StorageInvariantError extends Error {
  constructor(readonly code: string) {
    super(`storage invariant failed: ${code}`);
    this.name = 'StorageInvariantError';
  }
}

export class RedditRepository {
  constructor(private readonly database: D1Database) {}

  async storeSourceVersion(
    source: RedditSourceObject,
    contentVersion: string,
    seenAt: string,
  ): Promise<{ inserted: boolean; record: StoredSourceVersion }> {
    validateSource(source);
    validateContentVersion(contentVersion);
    const normalizedSeenAt = normalizeTimestamp(seenAt, 'seen_at');
    const sourceUpdatedAt = normalizeTimestamp(
      source.editedAt ?? source.createdAt,
      'source_updated_at',
    );
    const key = { sourceExternalId: source.externalId, contentVersion };
    const existing = await this.getSourceVersion(key);

    if (existing !== null) {
      const statements = [
        this.database
          .prepare(
            `UPDATE reddit_threads
             SET last_seen_at = CASE WHEN last_seen_at < ? THEN ? ELSE last_seen_at END
             WHERE thread_external_id = ? AND subreddit = ?`,
          )
          .bind(
            normalizedSeenAt,
            normalizedSeenAt,
            source.threadExternalId,
            source.subreddit,
          ),
        this.database
          .prepare(
            `UPDATE reddit_source_objects
             SET last_seen_at = CASE WHEN last_seen_at < ? THEN ? ELSE last_seen_at END
             WHERE source_external_id = ? AND content_version = ?`,
          )
          .bind(
            normalizedSeenAt,
            normalizedSeenAt,
            source.externalId,
            contentVersion,
          ),
      ];
      if (source.lifecycle !== 'active') {
        statements.push(
          this.database
            .prepare(
              `UPDATE reddit_source_objects
               SET title = NULL, body = NULL
               WHERE source_external_id = ?`,
            )
            .bind(source.externalId),
        );
      }
      await safeBatch(this.database, statements);
      return {
        inserted: false,
        record: await this.requireSourceVersion(key),
      };
    }

    const current = await this.getCurrentVersionHead(source.externalId);
    const becomesCurrent =
      source.lifecycle !== 'active' ||
      current === null ||
      compareVersionHeads({ contentVersion, sourceUpdatedAt }, current) > 0;
    const evaluationStatus: EvaluationStatus = becomesCurrent
      ? 'pending'
      : 'superseded';
    const retainedTitle =
      becomesCurrent && source.lifecycle === 'active' ? source.title : null;
    const retainedBody =
      becomesCurrent && source.lifecycle === 'active' ? source.body : null;

    const statements: D1PreparedStatement[] = [
      this.database
        .prepare(
          `INSERT INTO reddit_threads (
             thread_external_id, subreddit, first_seen_at, last_seen_at
           ) VALUES (?, ?, ?, ?)
           ON CONFLICT(thread_external_id) DO UPDATE SET
             last_seen_at = CASE
               WHEN last_seen_at < excluded.last_seen_at THEN excluded.last_seen_at
               ELSE last_seen_at
             END
           WHERE subreddit = excluded.subreddit`,
        )
        .bind(
          source.threadExternalId,
          source.subreddit,
          normalizedSeenAt,
          normalizedSeenAt,
        ),
    ];

    if (becomesCurrent) {
      statements.push(
        this.database
          .prepare(
            `UPDATE reddit_source_objects
             SET is_current = 0
             WHERE source_external_id = ? AND is_current = 1`,
          )
          .bind(source.externalId),
      );
    }
    if (source.lifecycle !== 'active') {
      statements.push(
        this.database
          .prepare(
            `UPDATE reddit_source_objects
             SET title = NULL, body = NULL
             WHERE source_external_id = ?`,
          )
          .bind(source.externalId),
      );
    }
    statements.push(
      this.database
        .prepare(
          `INSERT INTO reddit_source_objects (
             source_external_id, content_version, thread_external_id,
             parent_external_id, source_kind, subreddit, lifecycle, source_url,
             source_created_at, source_updated_at, title, body, is_current,
             first_seen_at, last_seen_at, evaluation_status, evaluated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          source.externalId,
          contentVersion,
          source.threadExternalId,
          source.parentExternalId,
          source.sourceKind,
          source.subreddit,
          source.lifecycle,
          source.sourceUrl,
          normalizeTimestamp(source.createdAt, 'source_created_at'),
          sourceUpdatedAt,
          retainedTitle,
          retainedBody,
          becomesCurrent ? 1 : 0,
          normalizedSeenAt,
          normalizedSeenAt,
          evaluationStatus,
          evaluationStatus === 'superseded' ? normalizedSeenAt : null,
        ),
    );

    try {
      await safeBatch(this.database, statements);
    } catch (error) {
      if (
        error instanceof StorageInvariantError &&
        error.code === 'write_failed'
      ) {
        const concurrentlyStored = await this.getSourceVersion(key);
        if (concurrentlyStored !== null) {
          return { inserted: false, record: concurrentlyStored };
        }
      }
      throw error;
    }
    return { inserted: true, record: await this.requireSourceVersion(key) };
  }

  async recordEvaluation(
    key: SourceVersionKey,
    decisionInput: unknown,
    evaluatedAt: string,
    externalReportId?: string,
  ): Promise<StoredSourceVersion> {
    validateKey(key);
    const decision = parseParserDecision(decisionInput);
    const normalizedEvaluatedAt = normalizeTimestamp(
      evaluatedAt,
      'evaluated_at',
    );
    const existing = await this.requireSourceVersion(key);
    if (existing.evaluationStatus !== 'pending') return existing;

    let statement: D1PreparedStatement;
    if (decision.decision === 'irrelevant') {
      if (externalReportId !== undefined) {
        throw new StorageInvariantError('unexpected_external_report_id');
      }
      statement = this.database
        .prepare(
          `UPDATE reddit_source_objects
           SET evaluation_status = 'irrelevant', evaluated_at = ?,
               title = NULL, body = NULL
           WHERE source_external_id = ? AND content_version = ?
             AND evaluation_status = 'pending'`,
        )
        .bind(normalizedEvaluatedAt, key.sourceExternalId, key.contentVersion);
    } else {
      validateOpaqueId(externalReportId, 'external_report_id', 128);
      parseCrowdReportDeliveryRequest({
        externalReportId,
        ...(existing.source.sourceUrl === null
          ? {}
          : { sourceUrl: existing.source.sourceUrl }),
        report: decision.report,
      });
      statement = this.database
        .prepare(
          `UPDATE reddit_source_objects
           SET evaluation_status = 'report', evaluated_at = ?,
               parsed_report_json = ?, external_report_id = ?,
               delivery_status = 'pending', title = NULL, body = NULL
           WHERE source_external_id = ? AND content_version = ?
             AND evaluation_status = 'pending'`,
        )
        .bind(
          normalizedEvaluatedAt,
          JSON.stringify(decision.report),
          externalReportId,
          key.sourceExternalId,
          key.contentVersion,
        );
    }

    const statements = [statement];
    if (existing.source.sourceKind === 'post') {
      statements.push(
        this.database
          .prepare(
            `UPDATE reddit_threads
             SET selection_status = CASE
               WHEN selection_status = 'selected' THEN selection_status
               ELSE ?
             END
             WHERE thread_external_id = ?`,
          )
          .bind(
            decision.decision === 'report' ? 'selected' : 'irrelevant',
            existing.source.threadExternalId,
          ),
      );
    }

    await safeBatch(this.database, statements, 'evaluation_write_failed');
    return this.requireSourceVersion(key);
  }

  async ensureWorkflowIdentity(
    threadExternalId: string,
    proposedWorkflowId: string,
    assignedAt: string,
  ): Promise<{ assigned: boolean; workflowId: string }> {
    validateFullname(threadExternalId, 'thread_external_id', 't3_');
    validateOpaqueId(proposedWorkflowId, 'workflow_id', 128);
    const normalizedAssignedAt = normalizeTimestamp(
      assignedAt,
      'workflow_assigned_at',
    );
    const thread = await this.getThread(threadExternalId);
    if (thread === null) throw new StorageInvariantError('missing_thread');
    if (thread.selectionStatus !== 'selected') {
      throw new StorageInvariantError('thread_not_selected');
    }
    if (thread.workflowId !== undefined) {
      return { assigned: false, workflowId: thread.workflowId };
    }

    const result = await safeRun(
      this.database
        .prepare(
          `UPDATE reddit_threads
           SET workflow_id = ?, workflow_assigned_at = ?
           WHERE thread_external_id = ? AND selection_status = 'selected'
             AND workflow_id IS NULL`,
        )
        .bind(proposedWorkflowId, normalizedAssignedAt, threadExternalId),
    );
    const stored = await this.getThread(threadExternalId);
    if (stored?.workflowId === undefined) {
      throw new StorageInvariantError('workflow_assignment_failed');
    }
    return {
      assigned: (result.meta.changes ?? 0) > 0,
      workflowId: stored.workflowId,
    };
  }

  async recordDeliveryAcknowledgement(
    key: SourceVersionKey,
    responseInput: unknown,
    acknowledgedAt: string,
  ): Promise<StoredSourceVersion> {
    validateKey(key);
    const response = parseSiteAcceptedResponse(responseInput);
    const normalizedAcknowledgedAt = normalizeTimestamp(
      acknowledgedAt,
      'acknowledged_at',
    );
    const existing = await this.requireSourceVersion(key);
    if (existing.deliveryStatus === 'acknowledged') {
      if (
        existing.acknowledgement?.reportId !== response.reportId ||
        existing.acknowledgement.moderationStatus !== response.moderationStatus
      ) {
        throw new StorageInvariantError('acknowledgement_conflict');
      }
      return existing;
    }
    if (existing.deliveryStatus !== 'pending') {
      throw new StorageInvariantError('delivery_not_pending');
    }

    await safeRun(
      this.database
        .prepare(
          `UPDATE reddit_source_objects
           SET delivery_status = 'acknowledged', site_report_id = ?,
               moderation_status = ?, acknowledged_at = ?
           WHERE source_external_id = ? AND content_version = ?
             AND delivery_status = 'pending'`,
        )
        .bind(
          response.reportId,
          response.moderationStatus,
          normalizedAcknowledgedAt,
          key.sourceExternalId,
          key.contentVersion,
        ),
    );
    const stored = await this.requireSourceVersion(key);
    if (stored.deliveryStatus !== 'acknowledged') {
      throw new StorageInvariantError('acknowledgement_write_failed');
    }
    if (
      stored.acknowledgement?.reportId !== response.reportId ||
      stored.acknowledgement.moderationStatus !== response.moderationStatus
    ) {
      throw new StorageInvariantError('acknowledgement_conflict');
    }
    return stored;
  }

  async listPendingDeliveries(
    limit = 100,
  ): Promise<CrowdReportDeliveryRequest[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new StorageInvariantError('pending_delivery_limit');
    }
    let rows: Record<string, unknown>[];
    try {
      const result = await this.database
        .prepare(
          `SELECT external_report_id, source_url, parsed_report_json
           FROM reddit_source_objects
           WHERE delivery_status = 'pending'
           ORDER BY first_seen_at, source_external_id, content_version
           LIMIT ?`,
        )
        .bind(limit)
        .all<Record<string, unknown>>();
      rows = result.results;
    } catch {
      throw new StorageInvariantError('read_failed');
    }
    return rows.map(parsePendingDeliveryRow);
  }

  async getSourceVersion(
    key: SourceVersionKey,
  ): Promise<StoredSourceVersion | null> {
    validateKey(key);
    let row: Record<string, unknown> | null;
    try {
      row = await this.database
        .prepare(
          `SELECT * FROM reddit_source_objects
           WHERE source_external_id = ? AND content_version = ?`,
        )
        .bind(key.sourceExternalId, key.contentVersion)
        .first<Record<string, unknown>>();
    } catch {
      throw new StorageInvariantError('read_failed');
    }
    return row === null ? null : parseSourceVersionRow(row);
  }

  async getThread(threadExternalId: string): Promise<ThreadRecord | null> {
    validateFullname(threadExternalId, 'thread_external_id', 't3_');
    let row: Record<string, unknown> | null;
    try {
      row = await this.database
        .prepare(`SELECT * FROM reddit_threads WHERE thread_external_id = ?`)
        .bind(threadExternalId)
        .first<Record<string, unknown>>();
    } catch {
      throw new StorageInvariantError('read_failed');
    }
    return row === null ? null : parseThreadRow(row);
  }

  private async requireSourceVersion(
    key: SourceVersionKey,
  ): Promise<StoredSourceVersion> {
    const record = await this.getSourceVersion(key);
    if (record === null) throw new StorageInvariantError('missing_source');
    return record;
  }

  private async getCurrentVersionHead(
    sourceExternalId: string,
  ): Promise<{ contentVersion: string; sourceUpdatedAt: string } | null> {
    let row: Record<string, unknown> | null;
    try {
      row = await this.database
        .prepare(
          `SELECT content_version, source_updated_at
           FROM reddit_source_objects
           WHERE source_external_id = ? AND is_current = 1`,
        )
        .bind(sourceExternalId)
        .first<Record<string, unknown>>();
    } catch {
      throw new StorageInvariantError('read_failed');
    }
    if (row === null) return null;
    return {
      contentVersion: rowString(row, 'content_version'),
      sourceUpdatedAt: rowTimestamp(row, 'source_updated_at'),
    };
  }
}

function parseSourceVersionRow(
  row: Record<string, unknown>,
): StoredSourceVersion {
  try {
    const sourceKind = rowEnum(row, 'source_kind', ['post', 'reply'] as const);
    const lifecycle = rowEnum(row, 'lifecycle', [
      'active',
      'removed',
      'deleted',
    ] as const);
    const sourceExternalId = rowString(row, 'source_external_id');
    const threadExternalId = rowString(row, 'thread_external_id');
    const parentExternalId = rowNullableString(row, 'parent_external_id');
    validateFullname(sourceExternalId, 'source_external_id');
    validateFullname(threadExternalId, 'thread_external_id', 't3_');
    if (parentExternalId !== null) {
      validateFullname(parentExternalId, 'parent_external_id');
    }
    const subreddit = rowString(row, 'subreddit');
    if (!SUBREDDIT_PATTERN.test(subreddit)) corruptRow();
    const sourceUrl = parseStoredSourceUrl(
      rowNullableString(row, 'source_url'),
    );
    const contentVersion = rowString(row, 'content_version');
    validateContentVersion(contentVersion);
    const evaluationStatus = rowEnum(row, 'evaluation_status', [
      'pending',
      'superseded',
      'irrelevant',
      'report',
    ] as const);
    const deliveryStatus = rowEnum(row, 'delivery_status', [
      'none',
      'pending',
      'acknowledged',
    ] as const);
    const evaluatedAtValue = rowNullableString(row, 'evaluated_at');
    const reportJson = rowNullableString(row, 'parsed_report_json');
    const externalReportId = rowNullableString(row, 'external_report_id');
    const siteReportId = rowNullableString(row, 'site_report_id');
    const moderationStatus = rowNullableString(row, 'moderation_status');
    const acknowledgedAtValue = rowNullableString(row, 'acknowledged_at');

    let report: CrowdReport | undefined;
    if (reportJson !== null) {
      const parsedDecision = parseParserDecision({
        decision: 'report',
        report: JSON.parse(reportJson),
      });
      if (parsedDecision.decision !== 'report') corruptRow();
      report = parsedDecision.report;
    }
    if (externalReportId !== null) {
      validateOpaqueId(externalReportId, 'external_report_id', 128);
    }
    const evaluatedAt =
      evaluatedAtValue === null
        ? undefined
        : normalizeTimestamp(evaluatedAtValue, 'evaluated_at');
    let acknowledgement: StoredSourceVersion['acknowledgement'];
    if (
      siteReportId !== null ||
      moderationStatus !== null ||
      acknowledgedAtValue !== null
    ) {
      if (
        siteReportId === null ||
        moderationStatus === null ||
        acknowledgedAtValue === null
      ) {
        corruptRow();
      }
      const parsed = parseSiteAcceptedResponse({
        success: true,
        data: { id: siteReportId, status: moderationStatus },
      });
      acknowledgement = {
        ...parsed,
        acknowledgedAt: normalizeTimestamp(
          acknowledgedAtValue,
          'acknowledged_at',
        ),
      };
    }
    if (
      (evaluationStatus === 'report') !==
        (report !== undefined && externalReportId !== null) ||
      (deliveryStatus === 'acknowledged') !== (acknowledgement !== undefined)
    ) {
      corruptRow();
    }

    return {
      source: {
        sourceKind,
        externalId: sourceExternalId,
        threadExternalId,
        parentExternalId,
        subreddit,
        lifecycle,
        sourceUrl,
        createdAt: rowTimestamp(row, 'source_created_at'),
        editedAt:
          rowTimestamp(row, 'source_updated_at') ===
          rowTimestamp(row, 'source_created_at')
            ? null
            : rowTimestamp(row, 'source_updated_at'),
        title: rowNullableString(row, 'title'),
        body: rowNullableString(row, 'body'),
      },
      contentVersion,
      isCurrent: rowBoolean(row, 'is_current'),
      firstSeenAt: rowTimestamp(row, 'first_seen_at'),
      lastSeenAt: rowTimestamp(row, 'last_seen_at'),
      evaluationStatus,
      ...(evaluatedAt === undefined ? {} : { evaluatedAt }),
      ...(report === undefined ? {} : { report }),
      ...(externalReportId === null ? {} : { externalReportId }),
      deliveryStatus,
      ...(acknowledgement === undefined ? {} : { acknowledgement }),
    };
  } catch (error) {
    if (
      error instanceof StorageInvariantError &&
      error.code === 'corrupt_row'
    ) {
      throw error;
    }
    throw new StorageInvariantError('corrupt_row');
  }
}

function parseThreadRow(row: Record<string, unknown>): ThreadRecord {
  try {
    const threadExternalId = rowString(row, 'thread_external_id');
    validateFullname(threadExternalId, 'thread_external_id', 't3_');
    const subreddit = rowString(row, 'subreddit');
    if (!SUBREDDIT_PATTERN.test(subreddit)) corruptRow();
    const selectionStatus = rowEnum(row, 'selection_status', [
      'pending',
      'irrelevant',
      'selected',
    ] as const);
    const workflowId = rowNullableString(row, 'workflow_id');
    const workflowAssignedAtValue = rowNullableString(
      row,
      'workflow_assigned_at',
    );
    if ((workflowId === null) !== (workflowAssignedAtValue === null)) {
      corruptRow();
    }
    if (workflowId !== null) validateOpaqueId(workflowId, 'workflow_id', 128);
    return {
      threadExternalId,
      subreddit,
      selectionStatus,
      ...(workflowId === null ? {} : { workflowId }),
      ...(workflowAssignedAtValue === null
        ? {}
        : {
            workflowAssignedAt: normalizeTimestamp(
              workflowAssignedAtValue,
              'workflow_assigned_at',
            ),
          }),
      firstSeenAt: rowTimestamp(row, 'first_seen_at'),
      lastSeenAt: rowTimestamp(row, 'last_seen_at'),
    };
  } catch (error) {
    if (
      error instanceof StorageInvariantError &&
      error.code === 'corrupt_row'
    ) {
      throw error;
    }
    throw new StorageInvariantError('corrupt_row');
  }
}

function parsePendingDeliveryRow(
  row: Record<string, unknown>,
): CrowdReportDeliveryRequest {
  try {
    const externalReportId = rowString(row, 'external_report_id');
    const sourceUrl = rowNullableString(row, 'source_url');
    const reportJson = rowString(row, 'parsed_report_json');
    return parseCrowdReportDeliveryRequest({
      externalReportId,
      ...(sourceUrl === null ? {} : { sourceUrl }),
      report: JSON.parse(reportJson),
    });
  } catch {
    throw new StorageInvariantError('corrupt_row');
  }
}

function validateSource(source: RedditSourceObject): void {
  validateFullname(
    source.externalId,
    'source_external_id',
    source.sourceKind === 'post' ? 't3_' : 't1_',
  );
  validateFullname(source.threadExternalId, 'thread_external_id', 't3_');
  if (
    source.sourceKind === 'post' &&
    (source.externalId !== source.threadExternalId ||
      source.parentExternalId !== null)
  ) {
    throw new StorageInvariantError('post_identity');
  }
  if (source.parentExternalId !== null) {
    validateFullname(source.parentExternalId, 'parent_external_id');
  }
  if (!SUBREDDIT_PATTERN.test(source.subreddit)) {
    throw new StorageInvariantError('subreddit');
  }
  normalizeTimestamp(source.createdAt, 'source_created_at');
  if (source.editedAt !== null) {
    normalizeTimestamp(source.editedAt, 'source_updated_at');
  }
  parseStoredSourceUrl(source.sourceUrl);
  if (
    source.lifecycle !== 'active' &&
    (source.title !== null || source.body !== null)
  ) {
    throw new StorageInvariantError('inactive_source_content');
  }
}

function validateKey(key: SourceVersionKey): void {
  validateFullname(key.sourceExternalId, 'source_external_id');
  validateContentVersion(key.contentVersion);
}

function validateContentVersion(value: string): void {
  if (!CONTENT_VERSION_PATTERN.test(value)) {
    throw new StorageInvariantError('content_version');
  }
}

function validateFullname(
  value: string,
  code: string,
  prefix?: 't1_' | 't3_',
): void {
  if (
    !FULLNAME_PATTERN.test(value) ||
    (prefix !== undefined && !value.startsWith(prefix))
  ) {
    throw new StorageInvariantError(code);
  }
}

function validateOpaqueId(
  value: unknown,
  code: string,
  maximumLength: number,
): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > maximumLength ||
    !OPAQUE_ID_PATTERN.test(value)
  ) {
    throw new StorageInvariantError(code);
  }
}

function normalizeTimestamp(value: string, code: string): string {
  if (
    typeof value !== 'string' ||
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new StorageInvariantError(code);
  }
  return new Date(value).toISOString();
}

function parseStoredSourceUrl(value: string | null): string | null {
  if (value === null) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new StorageInvariantError('source_url');
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    !REDDIT_ORIGINS.has(url.origin)
  ) {
    throw new StorageInvariantError('source_url');
  }
  return url.toString();
}

function compareVersionHeads(
  left: { contentVersion: string; sourceUpdatedAt: string },
  right: { contentVersion: string; sourceUpdatedAt: string },
): number {
  const timestampOrder = left.sourceUpdatedAt.localeCompare(
    right.sourceUpdatedAt,
  );
  return timestampOrder === 0
    ? left.contentVersion.localeCompare(right.contentVersion)
    : timestampOrder;
}

async function safeBatch(
  database: D1Database,
  statements: D1PreparedStatement[],
  fallbackCode = 'write_failed',
): Promise<D1Result[]> {
  try {
    return await database.batch(statements);
  } catch {
    throw new StorageInvariantError(fallbackCode);
  }
}

async function safeRun(statement: D1PreparedStatement): Promise<D1Result> {
  try {
    return await statement.run();
  } catch {
    throw new StorageInvariantError('write_failed');
  }
}

function rowString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') corruptRow();
  return value;
}

function rowNullableString(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const value = row[key];
  if (value !== null && typeof value !== 'string') corruptRow();
  return value;
}

function rowTimestamp(row: Record<string, unknown>, key: string): string {
  return normalizeTimestamp(rowString(row, key), key);
}

function rowBoolean(row: Record<string, unknown>, key: string): boolean {
  const value = row[key];
  if (value !== 0 && value !== 1) corruptRow();
  return value === 1;
}

function rowEnum<const Values extends readonly string[]>(
  row: Record<string, unknown>,
  key: string,
  values: Values,
): Values[number] {
  const value = rowString(row, key);
  if (!values.includes(value)) corruptRow();
  return value as Values[number];
}

function corruptRow(): never {
  throw new StorageInvariantError('corrupt_row');
}
