import { applyD1Migrations, env } from 'cloudflare:test';
import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseRedditConversationAtom } from '../contracts/reddit-conversation-atom.js';
import {
  computeContentVersion,
  computeExternalReportId,
} from '../domain/source-identity.js';
import { RedditRepository } from '../storage/reddit-repository.js';
import { runThreadWorkflowCheck } from './thread-workflow.js';
import { RedditTransportError } from './public-shadow-reddit-transport.js';
import { syntheticRedditConversationFeed } from '../../test/fixtures/reddit-conversation-feed.js';

const NOW = new Date('2026-07-20T01:00:00.000Z');
const testEnv = env as typeof env & { TEST_MIGRATIONS: D1Migration[] };
const report = {
  reportScope: 'line' as const,
  observedAt: NOW.toISOString(),
  lineIds: ['CCL'],
  stationIds: [],
  effect: 'delay' as const,
  isStillHappening: true,
};

describe('thread Workflow checks', () => {
  beforeEach(async () => {
    await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
    await testEnv.DB.batch([
      testEnv.DB.prepare('DELETE FROM reddit_source_objects'),
      testEnv.DB.prepare('DELETE FROM reddit_threads'),
    ]);
  });

  it('stores and evaluates the monitored thread before delivering a useful reply', async () => {
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
      { sourceExternalId: root.externalId, contentVersion: rootVersion },
      { decision: 'report', report },
      NOW.toISOString(),
      await computeExternalReportId(root.externalId, rootVersion),
    );
    await repository.recordDeliveryAcknowledgement(
      { sourceExternalId: root.externalId, contentVersion: rootVersion },
      { reportId: 'site-root-report', moderationStatus: 'accepted' },
      NOW.toISOString(),
    );

    const parse = vi.fn(async () => ({ decision: 'report' as const, report }));
    const deliver = vi.fn().mockResolvedValue({
      reportId: 'site-reply-report',
      moderationStatus: 'accepted' as const,
    });

    await expect(
      runThreadWorkflowCheck({
        threadExternalId: 't3_synthetic1',
        repository,
        conversationTransport: {
          fetchConversation: async () => ({
            kind: 'conversation',
            conversation,
            metadata: {
              etag: null,
              lastModified: null,
              status: 200,
              contentType: 'application/atom+xml',
              responseBytes: 0,
              retryAfterAt: null,
              rateLimitRemaining: null,
              rateLimitResetAt: null,
            },
          }),
        },
        semanticParser: { parse },
        deliveryTransport: { deliver },
        now: () => NOW,
      }),
    ).resolves.toMatchObject({
      outcome: 'completed',
      snapshot: {
        observedObjectCount: 3,
        insertedSourceVersionCount: 2,
      },
      evaluation: { pendingCount: 2, reportCount: 1 },
      delivery: { readyCount: 1, acknowledgedCount: 1 },
    });
    expect(parse).toHaveBeenCalledOnce();
    expect(deliver).toHaveBeenCalledOnce();
  });

  it('retains the permanent upstream status on a transport failure', async () => {
    await expect(
      runThreadWorkflowCheck({
        threadExternalId: 't3_synthetic1',
        repository: new RedditRepository(testEnv.DB),
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
        semanticParser: { parse: vi.fn() },
        deliveryTransport: { deliver: vi.fn() },
        now: () => NOW,
      }),
    ).resolves.toMatchObject({
      outcome: 'transport_error',
      category: 'unexpected_status',
      status: 404,
    });
  });
});
