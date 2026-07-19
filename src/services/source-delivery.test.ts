import { applyD1Migrations, env } from 'cloudflare:test';
import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RedditSourceObject } from '../contracts/reddit-source.js';
import type { CrowdReportDeliveryRequest } from '../contracts/site.js';
import {
  computeContentVersion,
  computeExternalReportId,
} from '../domain/source-identity.js';
import { RedditRepository } from '../storage/reddit-repository.js';
import {
  SiteDeliveryError,
  type SiteCrowdReportTransport,
} from './site-crowd-report-transport.js';
import { deliverPendingSources } from './source-delivery.js';

const NOW = new Date('2026-07-19T01:00:00.000Z');
const testEnv = env as typeof env & { TEST_MIGRATIONS: D1Migration[] };
const report = {
  reportScope: 'line' as const,
  observedAt: NOW.toISOString(),
  lineIds: ['CCL'],
  stationIds: [],
  effect: 'delay' as const,
  isStillHappening: true,
};

describe('source delivery service', () => {
  beforeEach(async () => {
    await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
    await testEnv.DB.batch([
      testEnv.DB.prepare('DELETE FROM reddit_source_objects'),
      testEnv.DB.prepare('DELETE FROM reddit_threads'),
    ]);
  });

  it('keeps a temporary failure pending until retry time and acknowledges a stable replay', async () => {
    const { repository, key, externalReportId } = await seedPendingReport();
    const deliver = vi
      .fn<(request: CrowdReportDeliveryRequest) => Promise<never>>()
      .mockRejectedValueOnce(
        new SiteDeliveryError('server', true, 503, '2026-07-19T01:05:00.000Z'),
      );

    await expect(
      deliverPendingSources({
        repository,
        transport: { deliver },
        now: () => NOW,
      }),
    ).resolves.toEqual({
      readyCount: 1,
      acknowledgedCount: 0,
      retryableFailureCount: 1,
      terminalFailureCount: 0,
      failureCategoryCounts: { server: 1 },
    });
    await expect(repository.getSourceVersion(key)).resolves.toMatchObject({
      deliveryStatus: 'pending',
      deliveryAttemptCount: 1,
      deliveryFailure: {
        category: 'server',
        retryAt: '2026-07-19T01:05:00.000Z',
        terminal: false,
      },
    });
    await expect(
      repository.listReadyDeliveries('2026-07-19T01:04:59.000Z'),
    ).resolves.toEqual([]);

    deliver.mockResolvedValueOnce({
      reportId: 'site-report-1',
      moderationStatus: 'accepted',
    } as never);
    await expect(
      deliverPendingSources({
        repository,
        transport: { deliver } as Pick<SiteCrowdReportTransport, 'deliver'>,
        now: () => new Date('2026-07-19T01:05:00.000Z'),
      }),
    ).resolves.toMatchObject({
      readyCount: 1,
      acknowledgedCount: 1,
    });
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(deliver.mock.calls[0]?.[0].externalReportId).toBe(externalReportId);
    expect(deliver.mock.calls[1]?.[0]).toEqual(deliver.mock.calls[0]?.[0]);
    await expect(repository.getSourceVersion(key)).resolves.toMatchObject({
      deliveryStatus: 'acknowledged',
      deliveryAttemptCount: 2,
      acknowledgement: { reportId: 'site-report-1' },
    });
  });

  it('stores a terminal conflict and excludes it from automatic retries', async () => {
    const { repository, key } = await seedPendingReport();
    const transport = {
      deliver: vi
        .fn()
        .mockRejectedValue(
          new SiteDeliveryError('idempotency_conflict', false, 409),
        ),
    };

    await expect(
      deliverPendingSources({ repository, transport, now: () => NOW }),
    ).resolves.toMatchObject({
      readyCount: 1,
      terminalFailureCount: 1,
      failureCategoryCounts: { idempotency_conflict: 1 },
    });
    await expect(repository.getSourceVersion(key)).resolves.toMatchObject({
      deliveryStatus: 'pending',
      deliveryFailure: {
        category: 'idempotency_conflict',
        terminal: true,
      },
    });
    await expect(
      repository.listReadyDeliveries('2026-07-20T01:00:00.000Z'),
    ).resolves.toEqual([]);
  });
});

async function seedPendingReport() {
  const repository = new RedditRepository(testEnv.DB);
  const source: RedditSourceObject = {
    sourceKind: 'post',
    externalId: 't3_deliveryfixture',
    threadExternalId: 't3_deliveryfixture',
    parentExternalId: null,
    subreddit: 'singapore',
    lifecycle: 'active',
    sourceUrl:
      'https://www.reddit.com/r/singapore/comments/deliveryfixture/example/',
    createdAt: NOW.toISOString(),
    editedAt: null,
    title: 'Synthetic rail condition',
    body: 'Synthetic fixture content only.',
  };
  const contentVersion = await computeContentVersion(source);
  const externalReportId = await computeExternalReportId(
    source.externalId,
    contentVersion,
  );
  const key = { sourceExternalId: source.externalId, contentVersion };
  await repository.storeSourceVersion(
    source,
    contentVersion,
    NOW.toISOString(),
  );
  await repository.recordEvaluation(
    key,
    { decision: 'report', report },
    NOW.toISOString(),
    externalReportId,
  );
  return { repository, key, externalReportId };
}
