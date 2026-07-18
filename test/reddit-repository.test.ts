import { applyD1Migrations, env } from 'cloudflare:test';
import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import { beforeEach, describe, expect, it } from 'vitest';

import type { RedditSourceObject } from '../src/contracts/reddit-source.js';
import {
  computeContentVersion,
  computeExternalReportId,
} from '../src/domain/source-identity.js';
import {
  RedditRepository,
  StorageInvariantError,
} from '../src/storage/reddit-repository.js';

const firstSeenAt = '2026-07-18T00:00:00.000Z';
const testEnv = env as typeof env & { TEST_MIGRATIONS: D1Migration[] };
const validReport = {
  reportScope: 'line',
  observedAt: '2026-07-18T08:00:00+08:00',
  lineIds: ['CCL'],
  stationIds: [],
  effect: 'delay',
  delayMinutes: 10,
  isStillHappening: true,
};

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
    createdAt: '2026-07-18T00:00:00.000Z',
    editedAt: null,
    title: 'Synthetic rail condition',
    body: 'Synthetic fixture content only.',
    ...changes,
  };
}

describe('RedditRepository', () => {
  beforeEach(async () => {
    await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
    await testEnv.DB.batch([
      testEnv.DB.prepare('DELETE FROM reddit_source_objects'),
      testEnv.DB.prepare('DELETE FROM reddit_threads'),
    ]);
  });

  it('stores repeated discovery once and advances only safe metadata', async () => {
    const repository = new RedditRepository(env.DB);
    const source = syntheticPost();
    const contentVersion = await computeContentVersion(source);
    expect(
      await computeContentVersion({
        ...source,
        sourceUrl:
          'https://www.reddit.com/r/singapore/comments/synthetic1/changed-slug/',
        createdAt: '2026-07-17T23:59:59.000Z',
        editedAt: '2026-07-18T00:00:01.000Z',
      }),
    ).toBe(contentVersion);

    const first = await repository.storeSourceVersion(
      source,
      contentVersion,
      firstSeenAt,
    );
    const repeated = await repository.storeSourceVersion(
      source,
      contentVersion,
      '2026-07-18T00:05:00Z',
    );

    expect(first.inserted).toBe(true);
    expect(repeated).toMatchObject({
      inserted: false,
      record: {
        contentVersion,
        evaluationStatus: 'pending',
        lastSeenAt: '2026-07-18T00:05:00.000Z',
      },
    });
    expect(
      await env.DB.prepare(
        'SELECT COUNT(*) AS count FROM reddit_source_objects',
      ).first('count'),
    ).toBe(1);
    expect(await repository.getThread(source.threadExternalId)).toMatchObject({
      selectionStatus: 'pending',
      firstSeenAt,
      lastSeenAt: '2026-07-18T00:05:00.000Z',
    });
  });

  it('evaluates a source version once and retains a stable pending report', async () => {
    const repository = new RedditRepository(env.DB);
    const source = syntheticPost();
    const contentVersion = await computeContentVersion(source);
    const externalReportId = await computeExternalReportId(
      source.externalId,
      contentVersion,
    );
    const key = { sourceExternalId: source.externalId, contentVersion };
    await repository.storeSourceVersion(source, contentVersion, firstSeenAt);

    const evaluated = await repository.recordEvaluation(
      key,
      { decision: 'report', report: validReport },
      '2026-07-18T00:01:00Z',
      externalReportId,
    );
    const repeatedWithDifferentDecision = await repository.recordEvaluation(
      key,
      { decision: 'irrelevant' },
      '2026-07-18T00:02:00Z',
    );

    expect(evaluated).toMatchObject({
      evaluationStatus: 'report',
      deliveryStatus: 'pending',
      externalReportId,
      report: validReport,
      source: { title: null, body: null },
    });
    expect(repeatedWithDifferentDecision).toEqual(evaluated);
    expect(await repository.getThread(source.threadExternalId)).toMatchObject({
      selectionStatus: 'selected',
    });
  });

  it('assigns one Workflow identity to a selected thread', async () => {
    const repository = new RedditRepository(env.DB);
    const source = syntheticPost();
    const contentVersion = await computeContentVersion(source);
    const externalReportId = await computeExternalReportId(
      source.externalId,
      contentVersion,
    );
    await repository.storeSourceVersion(source, contentVersion, firstSeenAt);
    await repository.recordEvaluation(
      { sourceExternalId: source.externalId, contentVersion },
      { decision: 'report', report: validReport },
      '2026-07-18T00:01:00Z',
      externalReportId,
    );

    await expect(
      repository.ensureWorkflowIdentity(
        source.threadExternalId,
        'workflow.synthetic.1',
        '2026-07-18T00:02:00Z',
      ),
    ).resolves.toEqual({
      assigned: true,
      workflowId: 'workflow.synthetic.1',
    });
    await expect(
      repository.ensureWorkflowIdentity(
        source.threadExternalId,
        'workflow.synthetic.2',
        '2026-07-18T00:03:00Z',
      ),
    ).resolves.toEqual({
      assigned: false,
      workflowId: 'workflow.synthetic.1',
    });
  });

  it('keeps failed delivery pending and records an idempotent acknowledgement', async () => {
    const repository = new RedditRepository(env.DB);
    const source = syntheticPost();
    const contentVersion = await computeContentVersion(source);
    const externalReportId = await computeExternalReportId(
      source.externalId,
      contentVersion,
    );
    const key = { sourceExternalId: source.externalId, contentVersion };
    await repository.storeSourceVersion(source, contentVersion, firstSeenAt);
    await repository.recordEvaluation(
      key,
      { decision: 'report', report: validReport },
      '2026-07-18T00:01:00Z',
      externalReportId,
    );

    await expect(repository.listPendingDeliveries()).resolves.toEqual([
      {
        externalReportId,
        sourceUrl: source.sourceUrl,
        report: validReport,
      },
    ]);
    const response = {
      reportId: 'site-report-synthetic-1',
      moderationStatus: 'accepted',
    };
    const acknowledged = await repository.recordDeliveryAcknowledgement(
      key,
      response,
      '2026-07-18T00:03:00Z',
    );

    expect(acknowledged).toMatchObject({
      deliveryStatus: 'acknowledged',
      acknowledgement: {
        ...response,
        acknowledgedAt: '2026-07-18T00:03:00.000Z',
      },
    });
    await expect(repository.listPendingDeliveries()).resolves.toEqual([]);
    await expect(
      repository.recordDeliveryAcknowledgement(
        key,
        response,
        '2026-07-18T00:04:00Z',
      ),
    ).resolves.toEqual(acknowledged);
    await expect(
      repository.recordDeliveryAcknowledgement(
        key,
        { ...response, reportId: 'conflicting-site-report' },
        '2026-07-18T00:04:00Z',
      ),
    ).rejects.toThrowError(
      new StorageInvariantError('acknowledgement_conflict'),
    );
  });

  it('tracks edited versions independently and purges content on removal', async () => {
    const repository = new RedditRepository(env.DB);
    const original = syntheticPost();
    const originalVersion = await computeContentVersion(original);
    await repository.storeSourceVersion(original, originalVersion, firstSeenAt);

    const edited = syntheticPost({
      editedAt: '2026-07-18T00:10:00.000Z',
      body: 'Changed synthetic fixture content.',
    });
    const editedVersion = await computeContentVersion(edited);
    await repository.storeSourceVersion(
      edited,
      editedVersion,
      '2026-07-18T00:10:01Z',
    );

    expect(
      await repository.getSourceVersion({
        sourceExternalId: original.externalId,
        contentVersion: originalVersion,
      }),
    ).toMatchObject({ isCurrent: false, evaluationStatus: 'pending' });
    expect(
      await repository.getSourceVersion({
        sourceExternalId: edited.externalId,
        contentVersion: editedVersion,
      }),
    ).toMatchObject({ isCurrent: true, evaluationStatus: 'pending' });

    const removed = syntheticPost({
      lifecycle: 'removed',
      title: null,
      body: null,
    });
    const removedVersion = await computeContentVersion(removed);
    await repository.storeSourceVersion(
      removed,
      removedVersion,
      '2026-07-18T00:20:00Z',
    );

    const rows = await env.DB.prepare(
      `SELECT content_version, title, body, is_current
       FROM reddit_source_objects
       WHERE source_external_id = ?
       ORDER BY content_version`,
    )
      .bind(original.externalId)
      .all();
    expect(rows.results).toHaveLength(3);
    expect(
      rows.results.every((row) => row.title === null && row.body === null),
    ).toBe(true);
    expect(rows.results.filter((row) => row.is_current === 1)).toEqual([
      expect.objectContaining({ content_version: removedVersion }),
    ]);
  });
});
