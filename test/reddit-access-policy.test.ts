import { applyD1Migrations, env } from 'cloudflare:test';
import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BackoffAwarePublicShadowRedditTransport } from '../src/services/reddit-access-policy.js';
import {
  type RedditResponseMetadata,
  RedditTransportError,
} from '../src/services/public-shadow-reddit-transport.js';
import { RedditAccessRepository } from '../src/storage/reddit-access-repository.js';

const NOW = new Date('2026-07-19T01:00:00Z');
const testEnv = env as typeof env & { TEST_MIGRATIONS: D1Migration[] };

function metadata(
  overrides: Partial<RedditResponseMetadata> = {},
): RedditResponseMetadata {
  return {
    status: 200,
    contentType: 'application/atom+xml',
    responseBytes: 1_000,
    etag: null,
    lastModified: null,
    retryAfterAt: null,
    rateLimitRemaining: null,
    rateLimitResetAt: null,
    ...overrides,
  };
}

function discoveryResult(responseMetadata = metadata()) {
  return {
    feed: {
      candidates: [],
      rejectedEntryCount: 0,
      duplicateEntryCount: 0,
    },
    metadata: responseMetadata,
  };
}

describe('durable Reddit access policy', () => {
  beforeEach(async () => {
    await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
    await testEnv.DB.prepare('DELETE FROM reddit_transport_state').run();
  });

  it('pauses later requests when a successful response exhausts quota', async () => {
    const fetchCandidates = vi.fn(async () =>
      discoveryResult(
        metadata({
          rateLimitRemaining: 0,
          rateLimitResetAt: '2026-07-19T01:01:00.000Z',
        }),
      ),
    );
    const fetchConversation = vi.fn();
    const repository = new RedditAccessRepository(testEnv.DB);
    const transport = new BackoffAwarePublicShadowRedditTransport(
      { fetchCandidates },
      { fetchConversation },
      repository,
      () => NOW,
    );

    await expect(
      transport.fetchCandidates('singapore', 'synthetic rail'),
    ).resolves.toBeDefined();
    await expect(
      transport.fetchConversation('t3_synthetic1'),
    ).rejects.toMatchObject({
      reason: 'backoff',
      resumeAt: '2026-07-19T01:01:00.000Z',
    });
    expect(fetchConversation).not.toHaveBeenCalled();
    await expect(repository.getState()).resolves.toMatchObject({
      blockedUntil: '2026-07-19T01:01:00.000Z',
      lastSuccessAt: NOW.toISOString(),
      rateLimitRemaining: 0,
    });
  });

  it('disables public-shadow access after two consecutive rate limits', async () => {
    let currentTime = NOW;
    const fetchCandidates = vi.fn(async () => {
      throw new RedditTransportError(
        'rate_limited',
        metadata({
          status: 429,
          retryAfterAt: new Date(currentTime.valueOf() + 30_000).toISOString(),
          rateLimitRemaining: 0,
        }),
      );
    });
    const repository = new RedditAccessRepository(testEnv.DB);
    const transport = new BackoffAwarePublicShadowRedditTransport(
      { fetchCandidates },
      { fetchConversation: vi.fn() },
      repository,
      () => currentTime,
    );

    await expect(
      transport.fetchCandidates('singapore', 'synthetic rail'),
    ).rejects.toMatchObject({ category: 'rate_limited' });
    currentTime = new Date(NOW.valueOf() + 301_000);
    await expect(
      transport.fetchCandidates('singapore', 'synthetic rail'),
    ).rejects.toMatchObject({ category: 'rate_limited' });
    currentTime = new Date(NOW.valueOf() + 602_000);
    await expect(
      transport.fetchCandidates('singapore', 'synthetic rail'),
    ).rejects.toMatchObject({ reason: 'disabled', resumeAt: null });
    expect(fetchCandidates).toHaveBeenCalledTimes(2);
    await expect(repository.getState()).resolves.toMatchObject({
      disabledReason: 'repeated_rate_limited',
      consecutiveRateLimits: 2,
    });
  });

  it('disables access after three consecutive malformed response shapes', async () => {
    const fetchCandidates = vi.fn(async () => {
      throw new RedditTransportError('malformed_response', metadata());
    });
    const repository = new RedditAccessRepository(testEnv.DB);
    const transport = new BackoffAwarePublicShadowRedditTransport(
      { fetchCandidates },
      { fetchConversation: vi.fn() },
      repository,
      () => NOW,
    );

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(
        transport.fetchCandidates('singapore', 'synthetic rail'),
      ).rejects.toMatchObject({ category: 'malformed_response' });
    }
    await expect(
      transport.fetchCandidates('singapore', 'synthetic rail'),
    ).rejects.toMatchObject({ reason: 'disabled' });
    expect(fetchCandidates).toHaveBeenCalledTimes(3);
    await expect(repository.getState()).resolves.toMatchObject({
      disabledReason: 'sustained_shape_failure',
      consecutiveShapeFailures: 3,
    });
  });

  it.each([
    ['authentication', 'authentication'],
    ['blocked', 'blocked'],
    ['invalid_content_type', 'invalid_content_type'],
  ] as const)('stops immediately on %s failures', async (category, reason) => {
    const fetchCandidates = vi.fn(async () => {
      throw new RedditTransportError(category, metadata());
    });
    const repository = new RedditAccessRepository(testEnv.DB);
    const transport = new BackoffAwarePublicShadowRedditTransport(
      { fetchCandidates },
      { fetchConversation: vi.fn() },
      repository,
      () => NOW,
    );

    await expect(
      transport.fetchCandidates('singapore', 'synthetic rail'),
    ).rejects.toMatchObject({ category });
    await expect(
      transport.fetchCandidates('singapore', 'synthetic rail'),
    ).rejects.toMatchObject({ reason: 'disabled' });
    expect(fetchCandidates).toHaveBeenCalledTimes(1);
    await expect(repository.getState()).resolves.toMatchObject({
      disabledReason: reason,
    });
  });
});
