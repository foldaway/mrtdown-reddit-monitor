import type { RedditDiscoveryCandidate } from '../contracts/reddit-search-atom.js';

const THREAD_EXTERNAL_ID_PATTERN = /^t3_[a-z0-9]+$/;
const SUBREDDIT_PATTERN = /^[A-Za-z0-9_]{1,21}$/;

export interface StoredRedditDiscoveryCandidate {
  threadExternalId: string;
  subreddit: string;
  firstDiscoveredAt: string;
  lastDiscoveredAt: string;
}

export class RedditDiscoveryCandidateStorageError extends Error {
  constructor(readonly code: 'corrupt_row' | 'read_failed' | 'write_failed') {
    super(`Reddit discovery candidate storage failed: ${code}`);
    this.name = 'RedditDiscoveryCandidateStorageError';
  }
}

/**
 * Holds validated RSS search identities until the shared RSS budget can fetch
 * their authoritative conversation feed. Search-feed content never enters D1.
 */
export class RedditDiscoveryCandidateRepository {
  constructor(private readonly database: D1Database) {}

  async enqueue(
    candidate: RedditDiscoveryCandidate,
    discoveredAt: string,
  ): Promise<void> {
    validateCandidate(candidate);
    const timestamp = normalizeTimestamp(discoveredAt);
    try {
      await this.database
        .prepare(
          `INSERT INTO reddit_discovery_candidates (
             thread_external_id, subreddit, first_discovered_at, last_discovered_at
           ) VALUES (?, ?, ?, ?)
           ON CONFLICT(thread_external_id) DO UPDATE SET
             last_discovered_at = CASE
               WHEN reddit_discovery_candidates.last_discovered_at < excluded.last_discovered_at
                 THEN excluded.last_discovered_at
               ELSE reddit_discovery_candidates.last_discovered_at
             END,
             subreddit = excluded.subreddit
           WHERE reddit_discovery_candidates.subreddit = excluded.subreddit`,
        )
        .bind(
          candidate.threadExternalId,
          candidate.subreddit,
          timestamp,
          timestamp,
        )
        .run();
    } catch {
      throw new RedditDiscoveryCandidateStorageError('write_failed');
    }
  }

  async getOldest(): Promise<StoredRedditDiscoveryCandidate | null> {
    let row: Record<string, unknown> | null;
    try {
      row = await this.database
        .prepare(
          `SELECT thread_external_id, subreddit, first_discovered_at, last_discovered_at
           FROM reddit_discovery_candidates
           ORDER BY first_discovered_at ASC, thread_external_id ASC
           LIMIT 1`,
        )
        .first<Record<string, unknown>>();
    } catch {
      throw new RedditDiscoveryCandidateStorageError('read_failed');
    }
    return row === null ? null : parseCandidate(row);
  }

  async remove(threadExternalId: string): Promise<void> {
    validateThreadExternalId(threadExternalId);
    try {
      await this.database
        .prepare(
          'DELETE FROM reddit_discovery_candidates WHERE thread_external_id = ?',
        )
        .bind(threadExternalId)
        .run();
    } catch {
      throw new RedditDiscoveryCandidateStorageError('write_failed');
    }
  }
}

function parseCandidate(
  row: Record<string, unknown>,
): StoredRedditDiscoveryCandidate {
  try {
    const threadExternalId = parseThreadExternalId(row.thread_external_id);
    const subreddit = parseSubreddit(row.subreddit);
    return {
      threadExternalId,
      subreddit,
      firstDiscoveredAt: parseTimestamp(row.first_discovered_at),
      lastDiscoveredAt: parseTimestamp(row.last_discovered_at),
    };
  } catch (error) {
    if (error instanceof RedditDiscoveryCandidateStorageError) throw error;
    throw new RedditDiscoveryCandidateStorageError('corrupt_row');
  }
}

function validateCandidate(candidate: RedditDiscoveryCandidate): void {
  if (typeof candidate !== 'object' || candidate === null) {
    throw new TypeError('Invalid Reddit discovery candidate');
  }
  validateThreadExternalId(candidate.threadExternalId);
  parseSubreddit(candidate.subreddit);
  if (typeof candidate.sourceUrl !== 'string') {
    throw new TypeError('Invalid Reddit discovery candidate URL');
  }
}

function validateThreadExternalId(value: string): void {
  if (!THREAD_EXTERNAL_ID_PATTERN.test(value)) {
    throw new TypeError('Invalid Reddit thread external ID');
  }
}

function parseThreadExternalId(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Invalid thread ID');
  validateThreadExternalId(value);
  return value;
}

function parseSubreddit(value: unknown): string {
  if (typeof value !== 'string' || !SUBREDDIT_PATTERN.test(value)) {
    throw new TypeError('Invalid subreddit');
  }
  return value;
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
