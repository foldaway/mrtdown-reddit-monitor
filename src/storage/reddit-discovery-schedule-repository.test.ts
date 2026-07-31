import { applyD1Migrations, env } from 'cloudflare:test';
import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import { beforeEach, describe, expect, it } from 'vitest';

import { RedditDiscoveryCandidateRepository } from './reddit-discovery-candidate-repository.js';
import { RedditDiscoveryScheduleRepository } from './reddit-discovery-schedule-repository.js';

const testEnv = env as typeof env & { TEST_MIGRATIONS: D1Migration[] };
const SUBREDDITS = ['singapore', 'askSingapore'];
const CANDIDATE = {
  threadExternalId: 't3_synthetic1',
  subreddit: 'singapore',
  sourceUrl: 'https://www.reddit.com/r/singapore/comments/synthetic1/fixture/',
};

describe('durable discovery scheduling', () => {
  beforeEach(async () => {
    await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
    await testEnv.DB.batch([
      testEnv.DB.prepare('DELETE FROM reddit_discovery_candidates'),
      testEnv.DB.prepare('DELETE FROM reddit_discovery_schedule'),
    ]);
  });

  it('persists subreddit rotation across separate repository instances', async () => {
    const first = new RedditDiscoveryScheduleRepository(testEnv.DB);
    await expect(first.getNextSubreddit(SUBREDDITS)).resolves.toBe('singapore');
    await first.advanceAfterSearch('singapore', SUBREDDITS);

    const second = new RedditDiscoveryScheduleRepository(testEnv.DB);
    await expect(second.getNextSubreddit(SUBREDDITS)).resolves.toBe(
      'askSingapore',
    );
    await second.advanceAfterSearch('askSingapore', SUBREDDITS);
    await expect(second.getNextSubreddit(SUBREDDITS)).resolves.toBe(
      'singapore',
    );
  });

  it('rotates permanent hydration failures and quarantines them after three attempts', async () => {
    const queue = new RedditDiscoveryCandidateRepository(testEnv.DB);
    await queue.enqueue(CANDIDATE, '2026-08-01T00:00:00.000Z');
    await queue.enqueue(
      {
        ...CANDIDATE,
        threadExternalId: 't3_synthetic2',
        subreddit: 'askSingapore',
        sourceUrl:
          'https://www.reddit.com/r/askSingapore/comments/synthetic2/fixture/',
      },
      '2026-08-01T00:00:01.000Z',
    );

    await expect(queue.getOldest()).resolves.toMatchObject({
      threadExternalId: 't3_synthetic1',
    });
    await expect(
      queue.recordPermanentHydrationFailure(
        't3_synthetic1',
        '2026-08-01T00:01:00.000Z',
      ),
    ).resolves.toEqual({ quarantined: false });
    await expect(queue.getOldest()).resolves.toMatchObject({
      threadExternalId: 't3_synthetic2',
    });

    await queue.recordPermanentHydrationFailure(
      't3_synthetic1',
      '2026-08-01T00:02:00.000Z',
    );
    await expect(
      queue.recordPermanentHydrationFailure(
        't3_synthetic1',
        '2026-08-01T00:03:00.000Z',
      ),
    ).resolves.toEqual({ quarantined: true });
    await expect(
      testEnv.DB.prepare(
        `SELECT hydration_failure_count, hydration_status
         FROM reddit_discovery_candidates WHERE thread_external_id = ?`,
      )
        .bind('t3_synthetic1')
        .first(),
    ).resolves.toEqual({
      hydration_failure_count: 3,
      hydration_status: 'quarantined',
    });
  });
});
