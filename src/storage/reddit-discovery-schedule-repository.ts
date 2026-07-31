const SCHEDULE = 'public-shadow';
const SUBREDDIT_PATTERN = /^[A-Za-z0-9_]{1,21}$/;

export class RedditDiscoveryScheduleStorageError extends Error {
  constructor(readonly code: 'corrupt_row' | 'read_failed' | 'write_failed') {
    super(`Reddit discovery schedule storage failed: ${code}`);
    this.name = 'RedditDiscoveryScheduleStorageError';
  }
}

/** Stores the next scheduled community independently of elapsed wall time. */
export class RedditDiscoveryScheduleRepository {
  constructor(private readonly database: D1Database) {}

  async getNextSubreddit(subreddits: string[]): Promise<string> {
    validateSubreddits(subreddits);
    let row: Record<string, unknown> | null;
    try {
      row = await this.database
        .prepare(
          `INSERT INTO reddit_discovery_schedule (schedule, next_subreddit)
           VALUES (?, ?)
           ON CONFLICT(schedule) DO NOTHING
           RETURNING next_subreddit`,
        )
        .bind(SCHEDULE, subreddits[0])
        .first<Record<string, unknown>>();
      if (row === null) {
        row = await this.database
          .prepare(
            'SELECT next_subreddit FROM reddit_discovery_schedule WHERE schedule = ?',
          )
          .bind(SCHEDULE)
          .first<Record<string, unknown>>();
      }
    } catch {
      throw new RedditDiscoveryScheduleStorageError('read_failed');
    }
    if (row === null)
      throw new RedditDiscoveryScheduleStorageError('read_failed');
    const subreddit = parseSubreddit(row.next_subreddit);
    const fallback = subreddits[0];
    if (fallback === undefined) throw new TypeError('No discovery subreddits');
    return (
      subreddits.find(
        (candidate) => candidate.toLowerCase() === subreddit.toLowerCase(),
      ) ?? fallback
    );
  }

  async advanceAfterSearch(
    searchedSubreddit: string,
    subreddits: string[],
  ): Promise<void> {
    validateSubreddits(subreddits);
    const index = subreddits.findIndex(
      (candidate) =>
        candidate.toLowerCase() === searchedSubreddit.toLowerCase(),
    );
    if (index === -1) throw new TypeError('Unknown scheduled subreddit');
    const nextSubreddit = subreddits[(index + 1) % subreddits.length];
    if (nextSubreddit === undefined) {
      throw new TypeError('No discovery subreddits');
    }
    try {
      await this.database
        .prepare(
          `INSERT INTO reddit_discovery_schedule (schedule, next_subreddit)
           VALUES (?, ?)
           ON CONFLICT(schedule) DO UPDATE SET next_subreddit = excluded.next_subreddit`,
        )
        .bind(SCHEDULE, nextSubreddit)
        .run();
    } catch {
      throw new RedditDiscoveryScheduleStorageError('write_failed');
    }
  }
}

function validateSubreddits(subreddits: string[]): void {
  if (!Array.isArray(subreddits) || subreddits.length === 0) {
    throw new TypeError('No discovery subreddits');
  }
  for (const subreddit of subreddits) parseSubreddit(subreddit);
}

function parseSubreddit(value: unknown): string {
  if (typeof value !== 'string' || !SUBREDDIT_PATTERN.test(value)) {
    throw new TypeError('Invalid subreddit');
  }
  return value;
}
