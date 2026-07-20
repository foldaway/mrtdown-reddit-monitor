import { applyD1Migrations, env } from 'cloudflare:test';
import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import { beforeEach, describe, expect, it } from 'vitest';

import type { RedditSourceObject } from '../contracts/reddit-source.js';
import {
  computeContentVersion,
  computeExternalReportId,
} from '../domain/source-identity.js';
import { RedditAccessRepository } from '../storage/reddit-access-repository.js';
import { RedditRepository } from '../storage/reddit-repository.js';
import { collectRuntimeMetrics } from './runtime-metrics.js';

const STARTED_AT = '2026-07-20T01:00:00.000Z';
const NOW = new Date('2026-07-20T01:05:00.000Z');
const testEnv = env as typeof env & { TEST_MIGRATIONS: D1Migration[] };

const report = {
  reportScope: 'line' as const,
  observedAt: STARTED_AT,
  lineIds: ['CCL'],
  stationIds: [],
  effect: 'delay' as const,
  isStillHappening: true,
};

const source: RedditSourceObject = {
  sourceKind: 'post',
  externalId: 't3_synthetic1',
  threadExternalId: 't3_synthetic1',
  parentExternalId: null,
  subreddit: 'singapore',
  lifecycle: 'active',
  sourceUrl: 'https://www.reddit.com/r/singapore/comments/synthetic1/fixture/',
  createdAt: STARTED_AT,
  editedAt: null,
  title: 'Synthetic condition',
  body: 'Synthetic content only.',
};

describe('runtime metrics', () => {
  beforeEach(async () => {
    await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
    await testEnv.DB.batch([
      testEnv.DB.prepare('DELETE FROM reddit_source_objects'),
      testEnv.DB.prepare('DELETE FROM reddit_threads'),
      testEnv.DB.prepare('DELETE FROM reddit_transport_state'),
    ]);
  });

  it('summarizes durable freshness, workflow, parser, delivery, and access state without source data', async () => {
    const repository = new RedditRepository(testEnv.DB);
    const accessRepository = new RedditAccessRepository(testEnv.DB);
    const contentVersion = await computeContentVersion(source);
    const key = { sourceExternalId: source.externalId, contentVersion };
    await repository.storeSourceVersion(source, contentVersion, STARTED_AT);
    await repository.recordEvaluation(
      key,
      { decision: 'report', report },
      STARTED_AT,
      await computeExternalReportId(source.externalId, contentVersion),
    );
    await repository.ensureWorkflowIdentity(
      source.threadExternalId,
      source.threadExternalId,
      STARTED_AT,
    );
    await repository.markWorkflowStarted(
      source.threadExternalId,
      source.threadExternalId,
      STARTED_AT,
    );
    await accessRepository.recordFailure('rate_limited', STARTED_AT, {
      blockedUntil: '2026-07-20T01:10:00.000Z',
      rateLimitRemaining: 0,
      rateLimitResetAt: '2026-07-20T01:10:00.000Z',
    });

    await expect(
      collectRuntimeMetrics({ repository, accessRepository, now: () => NOW }),
    ).resolves.toEqual({
      discoveryFreshnessSeconds: 300,
      activeWorkflowCount: 1,
      sourceEvaluationStatusCounts: {
        pending: 0,
        superseded: 0,
        irrelevant: 0,
        report: 1,
      },
      pendingDeliveryCount: 1,
      oldestPendingDeliveryAgeSeconds: 300,
      redditAccess: { state: 'backoff', rateLimitRemaining: 0 },
    });
  });
});
