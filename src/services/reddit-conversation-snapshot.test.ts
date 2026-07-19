import { applyD1Migrations, env } from 'cloudflare:test';
import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import { beforeEach, describe, expect, it } from 'vitest';

import { parseRedditConversationAtom } from '../contracts/reddit-conversation-atom.js';
import { computeContentVersion } from '../domain/source-identity.js';
import { RedditRepository } from '../storage/reddit-repository.js';
import { storeRedditConversationSnapshot } from './reddit-conversation-snapshot.js';
import {
  editSyntheticRootPost,
  syntheticRedditConversationFeed,
} from '../../test/fixtures/reddit-conversation-feed.js';

const testEnv = env as typeof env & { TEST_MIGRATIONS: D1Migration[] };

describe('Reddit conversation snapshots', () => {
  beforeEach(async () => {
    await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
    await testEnv.DB.batch([
      testEnv.DB.prepare('DELETE FROM reddit_source_objects'),
      testEnv.DB.prepare('DELETE FROM reddit_threads'),
    ]);
  });

  it('stores flat replies once and preserves objects absent from a later feed', async () => {
    const repository = new RedditRepository(env.DB);
    const conversation = await parseRedditConversationAtom(
      syntheticRedditConversationFeed,
      't3_synthetic1',
    );

    await expect(
      storeRedditConversationSnapshot(
        conversation,
        repository,
        '2026-07-18T00:07:00Z',
      ),
    ).resolves.toEqual({
      observedObjectCount: 3,
      insertedSourceVersionCount: 3,
      repeatedSourceVersionCount: 0,
    });
    await expect(
      storeRedditConversationSnapshot(
        { ...conversation, objects: conversation.objects.slice(0, 1) },
        repository,
        '2026-07-18T00:08:00Z',
      ),
    ).resolves.toEqual({
      observedObjectCount: 1,
      insertedSourceVersionCount: 0,
      repeatedSourceVersionCount: 1,
    });

    expect(
      await env.DB.prepare(
        'SELECT COUNT(*) AS count FROM reddit_source_objects',
      ).first('count'),
    ).toBe(3);
    expect(
      await env.DB.prepare(
        `SELECT parent_external_id, body
         FROM reddit_source_objects
         WHERE source_external_id = 't1_synthetic2'`,
      ).first(),
    ).toEqual({
      parent_external_id: null,
      body: 'Train is still held at one-north.',
    });
  });

  it('stores an edited root rectification as a new pending current version', async () => {
    const repository = new RedditRepository(env.DB);
    const initialConversation = await parseRedditConversationAtom(
      syntheticRedditConversationFeed,
      't3_synthetic1',
    );
    await storeRedditConversationSnapshot(
      initialConversation,
      repository,
      '2026-07-18T00:07:00Z',
    );

    const editedConversation = await parseRedditConversationAtom(
      editSyntheticRootPost(
        syntheticRedditConversationFeed,
        'Synthetic delay on the Circle Line.&lt;/p&gt;&lt;p&gt;Update: normal service has resumed.',
      ),
      't3_synthetic1',
    );
    await expect(
      storeRedditConversationSnapshot(
        editedConversation,
        repository,
        '2026-07-18T00:11:00Z',
      ),
    ).resolves.toEqual({
      observedObjectCount: 3,
      insertedSourceVersionCount: 1,
      repeatedSourceVersionCount: 2,
    });

    const initialRoot = initialConversation.objects[0];
    const editedRoot = editedConversation.objects[0];
    if (initialRoot === undefined || editedRoot === undefined) {
      throw new Error('Synthetic root missing');
    }
    await expect(
      repository.getSourceVersion({
        sourceExternalId: initialRoot.externalId,
        contentVersion: await computeContentVersion(initialRoot),
      }),
    ).resolves.toMatchObject({ isCurrent: false });
    await expect(
      repository.getSourceVersion({
        sourceExternalId: editedRoot.externalId,
        contentVersion: await computeContentVersion(editedRoot),
      }),
    ).resolves.toMatchObject({
      isCurrent: true,
      evaluationStatus: 'pending',
      source: {
        editedAt: '2026-07-18T00:10:00.000Z',
        body: 'Synthetic delay on the Circle Line. Update: normal service has resumed.',
      },
    });
  });
});
