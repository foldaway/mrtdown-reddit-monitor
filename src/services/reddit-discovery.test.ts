import { applyD1Migrations, env } from 'cloudflare:test';
import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseRedditConversationAtom } from '../contracts/reddit-conversation-atom.js';
import {
  RedditDiscoveryError,
  runRedditDiscovery,
  runScheduledRedditDiscovery,
} from './reddit-discovery.js';
import { RedditTransportError } from './public-shadow-reddit-transport.js';
import { RedditRepository } from '../storage/reddit-repository.js';
import { syntheticRedditConversationFeed } from '../../test/fixtures/reddit-conversation-feed.js';

const NOW = new Date('2026-07-18T01:00:00Z');
const testEnv = env as typeof env & { TEST_MIGRATIONS: D1Migration[] };

function discoveryResult(threadExternalId = 't3_synthetic1') {
  return {
    feed: {
      candidates: [
        {
          threadExternalId,
          subreddit: 'syntheticTransit',
          sourceUrl: `https://www.reddit.com/r/syntheticTransit/comments/${threadExternalId.slice(3)}/fixture/`,
        },
      ],
      rejectedEntryCount: 1,
      duplicateEntryCount: 1,
    },
    metadata: {
      status: 200,
      contentType: 'application/atom+xml',
      responseBytes: 1_000,
      etag: null,
      lastModified: null,
      retryAfterAt: null,
      rateLimitRemaining: null,
      rateLimitResetAt: null,
    },
  };
}

async function conversationResult() {
  return {
    kind: 'conversation' as const,
    conversation: await parseRedditConversationAtom(
      syntheticRedditConversationFeed.replaceAll(
        'singapore',
        'syntheticTransit',
      ),
      't3_synthetic1',
    ),
    metadata: {
      status: 200,
      contentType: 'application/atom+xml',
      responseBytes: 2_000,
      etag: null,
      lastModified: null,
      retryAfterAt: null,
      rateLimitRemaining: null,
      rateLimitResetAt: null,
    },
  };
}

describe('Reddit discovery service', () => {
  beforeEach(async () => {
    await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
    await testEnv.DB.batch([
      testEnv.DB.prepare('DELETE FROM reddit_source_objects'),
      testEnv.DB.prepare('DELETE FROM reddit_threads'),
    ]);
  });

  it('resolves new feed identities through conversation RSS before storage', async () => {
    const fetchCandidates = vi.fn(async () => discoveryResult());
    const fetchConversation = vi.fn(async () => conversationResult());
    const options = {
      subreddits: ['syntheticTransit'],
      query: 'mrt OR train',
      discoveryTransport: { fetchCandidates },
      conversationTransport: { fetchConversation },
      repository: new RedditRepository(env.DB),
      now: () => NOW,
    };

    await expect(runRedditDiscovery(options)).resolves.toEqual({
      feedCount: 1,
      candidateCount: 1,
      rejectedFeedEntryCount: 1,
      duplicateCandidateCount: 1,
      existingThreadCount: 0,
      fetchedConversationCount: 1,
      insertedSourceVersionCount: 1,
      repeatedSourceVersionCount: 0,
    });
    await expect(runRedditDiscovery(options)).resolves.toMatchObject({
      existingThreadCount: 1,
      fetchedConversationCount: 0,
      insertedSourceVersionCount: 0,
    });
    expect(fetchConversation).toHaveBeenCalledTimes(1);
    expect(
      await env.DB.prepare(
        'SELECT COUNT(*) AS count FROM reddit_source_objects',
      ).first('count'),
    ).toBe(1);
  });

  it('rejects a conversation whose normalized root does not match the feed', async () => {
    const repository = new RedditRepository(env.DB);

    await expect(
      runRedditDiscovery({
        subreddits: ['syntheticTransit'],
        query: 'mrt OR train',
        discoveryTransport: {
          fetchCandidates: async () => discoveryResult('t3_different'),
        },
        conversationTransport: {
          fetchConversation: async () => conversationResult(),
        },
        repository,
        now: () => NOW,
      }),
    ).rejects.toThrowError(new RedditDiscoveryError('candidate_mismatch'));
    await expect(repository.getThread('t3_different')).resolves.toBeNull();
  });

  it('defers a permanently missing candidate without blocking later discovery work', async () => {
    const recordPermanentHydrationFailure = vi.fn(async () => ({
      quarantined: false,
    }));

    await expect(
      runScheduledRedditDiscovery({
        subreddits: ['syntheticTransit'],
        query: 'mrt OR train',
        discoveryTransport: { fetchCandidates: vi.fn() },
        conversationTransport: {
          fetchConversation: async () => {
            throw new RedditTransportError('unexpected_status', {
              status: 404,
              contentType: null,
              responseBytes: 0,
              etag: null,
              lastModified: null,
              retryAfterAt: null,
              rateLimitRemaining: null,
              rateLimitResetAt: null,
            });
          },
        },
        candidateQueue: {
          enqueue: vi.fn(),
          getOldest: async () => ({
            threadExternalId: 't3_synthetic1',
            subreddit: 'syntheticTransit',
          }),
          remove: vi.fn(),
          recordPermanentHydrationFailure,
          quarantine: vi.fn(),
        },
        schedule: {
          getNextSubreddit: vi.fn(),
          advanceAfterSearch: vi.fn(),
        },
        repository: new RedditRepository(env.DB),
        now: () => NOW,
      }),
    ).resolves.toMatchObject({
      action: 'deferred_permanent_hydration_failure',
      permanentHydrationFailureCount: 1,
      quarantinedCandidateCount: 0,
    });
    expect(recordPermanentHydrationFailure).toHaveBeenCalledWith(
      't3_synthetic1',
      NOW.toISOString(),
    );
  });

  it('quarantines a mismatched candidate instead of pinning scheduled discovery', async () => {
    const quarantine = vi.fn();

    await expect(
      runScheduledRedditDiscovery({
        subreddits: ['syntheticTransit'],
        query: 'mrt OR train',
        discoveryTransport: { fetchCandidates: vi.fn() },
        conversationTransport: { fetchConversation: conversationResult },
        candidateQueue: {
          enqueue: vi.fn(),
          getOldest: async () => ({
            threadExternalId: 't3_synthetic1',
            subreddit: 'differentSubreddit',
          }),
          remove: vi.fn(),
          recordPermanentHydrationFailure: vi.fn(),
          quarantine,
        },
        schedule: {
          getNextSubreddit: vi.fn(),
          advanceAfterSearch: vi.fn(),
        },
        repository: new RedditRepository(env.DB),
        now: () => NOW,
      }),
    ).resolves.toMatchObject({
      action: 'quarantined_mismatched_candidate',
      quarantinedCandidateCount: 1,
    });
    expect(quarantine).toHaveBeenCalledWith('t3_synthetic1', NOW.toISOString());
  });

  it('does not count a re-seen quarantined candidate as queued', async () => {
    await expect(
      runScheduledRedditDiscovery({
        subreddits: ['syntheticTransit'],
        query: 'mrt OR train',
        discoveryTransport: { fetchCandidates: async () => discoveryResult() },
        conversationTransport: { fetchConversation: vi.fn() },
        candidateQueue: {
          enqueue: async () => ({ queued: false }),
          getOldest: async () => null,
          remove: vi.fn(),
          recordPermanentHydrationFailure: vi.fn(),
          quarantine: vi.fn(),
        },
        schedule: {
          getNextSubreddit: async () => 'syntheticTransit',
          advanceAfterSearch: vi.fn(),
        },
        repository: new RedditRepository(env.DB),
        now: () => NOW,
      }),
    ).resolves.toMatchObject({
      action: 'searched',
      candidateCount: 1,
      queuedCandidateCount: 0,
    });
  });
});
