import { applyD1Migrations, env } from 'cloudflare:test';
import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RedditSourceObject } from '../contracts/reddit-source.js';
import { computeContentVersion } from '../domain/source-identity.js';
import { RedditRepository } from '../storage/reddit-repository.js';
import { evaluatePendingSources } from './source-evaluation.js';

const NOW = new Date('2026-07-19T01:00:00.000Z');
const testEnv = env as typeof env & { TEST_MIGRATIONS: D1Migration[] };

function syntheticPost(
  changes: Partial<RedditSourceObject> = {},
): RedditSourceObject {
  return {
    sourceKind: 'post',
    externalId: 't3_synthetic1',
    threadExternalId: 't3_synthetic1',
    parentExternalId: null,
    subreddit: 'singapore',
    lifecycle: 'active',
    sourceUrl:
      'https://www.reddit.com/r/singapore/comments/synthetic1/fixture/',
    createdAt: NOW.toISOString(),
    editedAt: null,
    title: 'Synthetic CCL service delay',
    body: 'Synthetic fixture content only.',
    ...changes,
  };
}

describe('pending source evaluation', () => {
  beforeEach(async () => {
    await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
    await testEnv.DB.batch([
      testEnv.DB.prepare('DELETE FROM reddit_source_objects'),
      testEnv.DB.prepare('DELETE FROM reddit_threads'),
    ]);
  });

  it('rejects a non-rail post before semantic parsing', async () => {
    const repository = new RedditRepository(testEnv.DB);
    const source = syntheticPost({
      title: 'Synthetic neighbourhood discussion',
      body: 'A fixture without transport keywords.',
    });
    const contentVersion = await computeContentVersion(source);
    await repository.storeSourceVersion(
      source,
      contentVersion,
      NOW.toISOString(),
    );
    const parse = vi.fn();

    await expect(
      evaluatePendingSources({
        repository,
        semanticParser: { parse },
        now: () => NOW,
      }),
    ).resolves.toEqual({
      pendingCount: 1,
      filterRejectedCount: 1,
      parserIrrelevantCount: 0,
      reportCount: 0,
    });
    expect(parse).not.toHaveBeenCalled();
    await expect(
      repository.getSourceVersion({
        sourceExternalId: source.externalId,
        contentVersion,
      }),
    ).resolves.toMatchObject({
      evaluationStatus: 'irrelevant',
      source: { title: null, body: null },
    });
  });

  it('stores a validated semantic report as a stable pending delivery', async () => {
    const repository = new RedditRepository(testEnv.DB);
    const source = syntheticPost();
    const contentVersion = await computeContentVersion(source);
    await repository.storeSourceVersion(
      source,
      contentVersion,
      NOW.toISOString(),
    );
    const report = {
      reportScope: 'line' as const,
      observedAt: NOW.toISOString(),
      lineIds: ['CCL'],
      stationIds: [],
      effect: 'delay' as const,
      isStillHappening: true,
    };

    await expect(
      evaluatePendingSources({
        repository,
        semanticParser: {
          parse: vi.fn().mockResolvedValue({ decision: 'report', report }),
        },
        now: () => NOW,
      }),
    ).resolves.toMatchObject({ pendingCount: 1, reportCount: 1 });
    await expect(repository.listPendingDeliveries()).resolves.toEqual([
      expect.objectContaining({
        externalReportId: expect.stringMatching(/^reddit\.[a-f0-9]{64}$/),
        report,
      }),
    ]);
  });

  it('leaves a source pending when semantic inference fails', async () => {
    const repository = new RedditRepository(testEnv.DB);
    const source = syntheticPost();
    const contentVersion = await computeContentVersion(source);
    await repository.storeSourceVersion(
      source,
      contentVersion,
      NOW.toISOString(),
    );

    await expect(
      evaluatePendingSources({
        repository,
        semanticParser: {
          parse: vi.fn().mockRejectedValue(new Error('synthetic failure')),
        },
        now: () => NOW,
      }),
    ).rejects.toThrow('synthetic failure');
    await expect(repository.listPendingEvaluations()).resolves.toHaveLength(1);
  });
});
