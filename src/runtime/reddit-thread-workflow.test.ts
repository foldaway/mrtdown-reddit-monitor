import {
  applyD1Migrations,
  env,
  introspectWorkflowInstance,
} from 'cloudflare:test';
import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import { beforeEach, describe, expect, it } from 'vitest';

import { THREAD_WORKFLOW_POLL_OFFSETS_MINUTES } from '../services/thread-workflow.js';
import { RedditRepository } from '../storage/reddit-repository.js';
import {
  computeContentVersion,
  computeExternalReportId,
} from '../domain/source-identity.js';
import { syntheticRedditConversationFeed } from '../../test/fixtures/reddit-conversation-feed.js';
import { parseRedditConversationAtom } from '../contracts/reddit-conversation-atom.js';

const NOW = new Date('2026-07-21T00:00:00.000Z');
const RETRY_AT = new Date(Date.now() + 60_000).toISOString();
const testEnv = env as typeof env & { TEST_MIGRATIONS: D1Migration[] };

describe('Reddit thread Workflow runtime', () => {
  beforeEach(async () => {
    await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
    await testEnv.DB.batch([
      testEnv.DB.prepare('DELETE FROM reddit_source_objects'),
      testEnv.DB.prepare('DELETE FROM reddit_threads'),
    ]);
  });

  it('runs every fixed check and records completion when sleeps are advanced locally', async () => {
    const repository = new RedditRepository(testEnv.DB);
    const conversation = await parseRedditConversationAtom(
      syntheticRedditConversationFeed,
      't3_synthetic1',
    );
    const root = conversation.objects[0];
    if (root === undefined) throw new Error('Synthetic root missing');
    const rootVersion = await computeContentVersion(root);
    await repository.storeSourceVersion(root, rootVersion, NOW.toISOString());
    await repository.recordEvaluation(
      {
        sourceExternalId: root.externalId,
        contentVersion: rootVersion,
      },
      {
        decision: 'report',
        report: {
          reportScope: 'line',
          observedAt: NOW.toISOString(),
          lineIds: ['CCL'],
          stationIds: [],
          effect: 'delay',
          isStillHappening: true,
        },
      },
      NOW.toISOString(),
      await computeExternalReportId(root.externalId, rootVersion),
    );
    await repository.ensureWorkflowIdentity(
      root.threadExternalId,
      root.threadExternalId,
      NOW.toISOString(),
    );
    await repository.markWorkflowStarted(
      root.threadExternalId,
      root.threadExternalId,
      NOW.toISOString(),
    );

    await using instance = await introspectWorkflowInstance(
      testEnv.REDDIT_THREAD_WORKFLOW,
      root.threadExternalId,
    );
    await instance.modify(async (modifier) => {
      await modifier.disableSleeps();
      for (const offsetMinutes of THREAD_WORKFLOW_POLL_OFFSETS_MINUTES) {
        await modifier.mockStepResult(
          { name: `check +${offsetMinutes}m` },
          offsetMinutes === 10
            ? {
                outcome: 'paused',
                resumeAt: RETRY_AT,
                disabled: false,
              }
            : offsetMinutes === 25
              ? {
                  outcome: 'transport_error',
                  status: 404,
                  resumeAt: RETRY_AT,
                  disabled: false,
                }
              : { outcome: 'completed' },
        );
      }
      await modifier.mockStepResult(
        { name: 'retry +10m #1' },
        { outcome: 'completed' },
      );
    });

    await testEnv.REDDIT_THREAD_WORKFLOW.create({
      id: root.threadExternalId,
      params: { threadExternalId: root.threadExternalId },
    });
    await instance.waitForStatus('complete');

    await expect(instance.getOutput()).resolves.toEqual({
      checkCount: THREAD_WORKFLOW_POLL_OFFSETS_MINUTES.length,
    });
    for (const offsetMinutes of THREAD_WORKFLOW_POLL_OFFSETS_MINUTES) {
      await expect(
        instance.waitForStepResult({ name: `check +${offsetMinutes}m` }),
      ).resolves.toEqual(
        offsetMinutes === 10
          ? {
              outcome: 'paused',
              resumeAt: RETRY_AT,
              disabled: false,
            }
          : offsetMinutes === 25
            ? {
                outcome: 'transport_error',
                status: 404,
                resumeAt: RETRY_AT,
                disabled: false,
              }
            : { outcome: 'completed' },
      );
    }
    await expect(
      instance.waitForStepResult({ name: 'retry +10m #1' }),
    ).resolves.toEqual({ outcome: 'completed' });
    expect(
      (await repository.getThread(root.threadExternalId))?.workflowCompletedAt,
    ).toEqual(expect.any(String));
  });
});
