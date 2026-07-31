import { applyD1Migrations, env } from 'cloudflare:test';
import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SemanticParserError } from '../services/workers-ai-semantic-parser.js';
import { runScheduledDiscovery } from './scheduled-discovery.js';
import { syntheticReferenceCatalog } from '../../test/fixtures/reference-catalog.js';
import { syntheticRedditConversationFeed } from '../../test/fixtures/reddit-conversation-feed.js';
import { syntheticRedditSearchFeed } from '../../test/fixtures/reddit-search-feed.js';

const NOW = new Date('2026-07-19T01:00:00Z');
const testEnv = env as typeof env & { TEST_MIGRATIONS: D1Migration[] };
const singleCandidateSearchFeed = syntheticRedditSearchFeed.replace(
  / {2}<entry>\n {4}<id>t3_synthetic2[\s\S]*? {2}<\/entry>\n/,
  '',
);

function runtimeEnv(
  aiResponse: unknown = JSON.stringify({
    decision: 'report',
    report: {
      reportScope: 'line',
      observedAt: '2026-07-19T01:00:00.000Z',
      lineIds: ['CCL'],
      stationIds: [],
      effect: 'delay',
      isStillHappening: true,
    },
  }),
): Env {
  return {
    AI: {
      run: vi.fn().mockResolvedValue({
        response: aiResponse,
      }),
    } as unknown as Ai,
    DB: testEnv.DB,
    REDDIT_TRANSPORT_MODE: 'public-shadow',
    REDDIT_USER_AGENT_CONTACT: 'ops@example.invalid',
    REDDIT_SUBREDDITS: 'singapore',
    REDDIT_DISCOVERY_QUERY: 'synthetic rail condition',
    MRTDOWN_SITE_INGEST_URL:
      'https://example.invalid/internal/api/crowd-reports',
    MRTDOWN_SITE_REFERENCE_CATALOG_URL:
      'https://example.invalid/internal/api/reference-catalog/v1',
    MRTDOWN_SITE_INGEST_TOKEN: 'synthetic-site-token',
    REDDIT_THREAD_WORKFLOW: {
      create: vi.fn(async ({ id }: { id: string }) => ({
        id,
        status: async () => ({ status: 'queued' }),
      })),
      get: vi.fn(async (id: string) => ({
        id,
        status: async () => ({ status: 'queued' }),
      })),
    } as unknown as Workflow,
  };
}

describe('scheduled Reddit discovery runtime', () => {
  beforeEach(async () => {
    await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
    await testEnv.DB.batch([
      testEnv.DB.prepare('DELETE FROM reddit_source_objects'),
      testEnv.DB.prepare('DELETE FROM reddit_threads'),
      testEnv.DB.prepare('DELETE FROM reddit_transport_state'),
      testEnv.DB.prepare('DELETE FROM site_reference_catalog_cache'),
    ]);
  });

  it('wires public-shadow discovery and replays without refetching an existing conversation', async () => {
    const log = vi.fn();
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const request = new Request(input);
      if (request.url.includes('/reference-catalog/v1')) {
        return referenceCatalogResponse();
      }
      if (request.url.includes('/crowd-reports')) {
        return Response.json(
          {
            success: true,
            data: {
              id: 'site-report-synthetic-1',
              status: 'accepted',
              duplicateOfId: null,
              idempotentReplay: false,
            },
          },
          { status: 202 },
        );
      }
      if (request.url.includes('/search.rss')) {
        return new Response(singleCandidateSearchFeed, {
          status: 200,
          headers: { 'content-type': 'application/atom+xml' },
        });
      }
      return new Response(syntheticRedditConversationFeed, {
        status: 200,
        headers: { 'content-type': 'application/atom+xml' },
      });
    });
    let currentTime = NOW;
    const dependencies = { fetch, now: () => currentTime, log };

    await expect(
      runScheduledDiscovery(runtimeEnv(), dependencies),
    ).resolves.toMatchObject({
      outcome: 'completed',
      discovery: { action: 'searched', queuedCandidateCount: 1 },
    });
    await expect(
      runScheduledDiscovery(runtimeEnv(), dependencies),
    ).resolves.toMatchObject({
      outcome: 'paused',
      reason: 'backoff',
      resumeAt: '2026-07-19T01:01:00.000Z',
    });
    currentTime = new Date(NOW.valueOf() + 61_000);
    await expect(
      runScheduledDiscovery(runtimeEnv(), dependencies),
    ).resolves.toMatchObject({
      outcome: 'completed',
      discovery: {
        action: 'hydrated',
        insertedSourceVersionCount: 1,
        fetchedConversationCount: 1,
      },
      evaluation: { pendingCount: 1, reportCount: 1 },
      delivery: { readyCount: 1, acknowledgedCount: 1 },
    });
    currentTime = new Date(NOW.valueOf() + 122_000);
    await expect(
      runScheduledDiscovery(runtimeEnv(), dependencies),
    ).resolves.toMatchObject({
      outcome: 'completed',
      discovery: { action: 'searched', existingThreadCount: 1 },
    });
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(log).toHaveBeenLastCalledWith(
      expect.objectContaining({
        event: 'reddit_discovery_completed',
        existingThreadCount: 1,
        metrics: {
          discoveryFreshnessSeconds: 61,
          activeWorkflowCount: 1,
          sourceEvaluationStatusCounts: {
            pending: 0,
            superseded: 0,
            irrelevant: 0,
            report: 1,
          },
          pendingDeliveryCount: 0,
          oldestPendingDeliveryAgeSeconds: null,
          redditAccess: { state: 'backoff', rateLimitRemaining: null },
        },
      }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      'Synthetic delay on the Circle Line',
    );
    expect(
      await testEnv.DB.prepare(
        `SELECT COUNT(*) AS count FROM reddit_source_objects
         WHERE delivery_status = 'acknowledged'`,
      ).first('count'),
    ).toBe(1);
    expect(
      await testEnv.DB.prepare(
        'SELECT COUNT(*) AS count FROM site_reference_catalog_cache',
      ).first('count'),
    ).toBe(1);
  });

  it('records a rate limit and skips the next scheduled invocation during backoff', async () => {
    const log = vi.fn();
    const fetch = vi.fn(
      async () =>
        new Response(null, {
          status: 429,
          headers: { 'retry-after': '60' },
        }),
    );
    const dependencies = { fetch, now: () => NOW, log };

    await expect(
      runScheduledDiscovery(runtimeEnv(), dependencies),
    ).resolves.toMatchObject({
      outcome: 'transport_error',
      category: 'rate_limited',
      resumeAt: '2026-07-19T01:01:00.000Z',
    });
    await expect(
      runScheduledDiscovery(runtimeEnv(), dependencies),
    ).resolves.toMatchObject({
      outcome: 'paused',
      reason: 'backoff',
      resumeAt: '2026-07-19T01:01:00.000Z',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries pending site delivery even when Reddit enters backoff', async () => {
    let siteAttempt = 0;
    let redditRateLimited = false;
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const request = new Request(input);
      if (request.url.includes('/reference-catalog/v1')) {
        return referenceCatalogResponse();
      }
      if (request.url.includes('/crowd-reports')) {
        siteAttempt += 1;
        if (siteAttempt === 1) return new Response(null, { status: 503 });
        return Response.json(
          {
            success: true,
            data: { id: 'site-report-retry', status: 'accepted' },
          },
          { status: 202 },
        );
      }
      if (redditRateLimited) {
        return new Response(null, {
          status: 429,
          headers: { 'retry-after': '60' },
        });
      }
      return new Response(
        request.url.includes('/search.rss')
          ? singleCandidateSearchFeed
          : syntheticRedditConversationFeed,
        {
          status: 200,
          headers: { 'content-type': 'application/atom+xml' },
        },
      );
    });
    let currentTime = NOW;
    const dependencies = { fetch, now: () => currentTime, log: vi.fn() };

    await expect(
      runScheduledDiscovery(runtimeEnv(), dependencies),
    ).resolves.toMatchObject({
      outcome: 'completed',
      discovery: { action: 'searched', queuedCandidateCount: 1 },
    });
    currentTime = new Date(NOW.valueOf() + 61_000);
    await expect(
      runScheduledDiscovery(runtimeEnv(), dependencies),
    ).resolves.toMatchObject({
      outcome: 'completed',
      delivery: { readyCount: 1, retryableFailureCount: 1 },
    });
    redditRateLimited = true;
    currentTime = new Date(NOW.valueOf() + 122_000);
    await expect(
      runScheduledDiscovery(runtimeEnv(), dependencies),
    ).resolves.toMatchObject({
      outcome: 'transport_error',
      category: 'rate_limited',
      delivery: { readyCount: 1, acknowledgedCount: 1 },
    });
    expect(siteAttempt).toBe(2);
    expect(
      await testEnv.DB.prepare(
        `SELECT COUNT(*) AS count FROM reddit_source_objects
         WHERE delivery_status = 'acknowledged'`,
      ).first('count'),
    ).toBe(1);
  });

  it('logs a safe parser category and leaves evaluation pending on invalid output', async () => {
    const log = vi.fn();
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const request = new Request(input);
      if (request.url.includes('/reference-catalog/v1')) {
        return referenceCatalogResponse();
      }
      return new Response(
        request.url.includes('/search.rss')
          ? singleCandidateSearchFeed
          : syntheticRedditConversationFeed,
        {
          status: 200,
          headers: { 'content-type': 'application/atom+xml' },
        },
      );
    });

    let currentTime = NOW;
    const dependencies = { fetch, now: () => currentTime, log };
    await expect(
      runScheduledDiscovery(runtimeEnv('{invalid'), dependencies),
    ).resolves.toMatchObject({
      outcome: 'completed',
      discovery: { action: 'searched', queuedCandidateCount: 1 },
    });
    currentTime = new Date(NOW.valueOf() + 61_000);
    await expect(
      runScheduledDiscovery(runtimeEnv('{invalid'), dependencies),
    ).rejects.toEqual(new SemanticParserError('invalid_response'));
    expect(log).toHaveBeenLastCalledWith(
      expect.objectContaining({
        event: 'reddit_semantic_parser_error',
        category: 'invalid_response',
        metrics: expect.objectContaining({
          sourceEvaluationStatusCounts: expect.objectContaining({ pending: 1 }),
        }),
      }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      'Synthetic delay on the Circle Line',
    );
    expect(
      await testEnv.DB.prepare(
        `SELECT COUNT(*) AS count FROM reddit_source_objects
         WHERE evaluation_status = 'pending'`,
      ).first('count'),
    ).toBe(1);
  });
});

function referenceCatalogResponse(): Response {
  return Response.json(
    { success: true, data: syntheticReferenceCatalog },
    { headers: { 'cache-control': 'private, max-age=300' } },
  );
}
