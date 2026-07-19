import { describe, expect, it } from 'vitest';

import {
  REDDIT_CONVERSATION_ATOM_LIMITS,
  parseRedditConversationAtom,
} from './reddit-conversation-atom.js';
import { BoundaryValidationError } from './validation.js';
import {
  editSyntheticRootPost,
  syntheticRedditConversationFeed,
} from '../../test/fixtures/reddit-conversation-feed.js';

describe('Reddit conversation Atom boundary', () => {
  it('normalizes a flat post feed without author or parent identity', async () => {
    const conversation = await parseRedditConversationAtom(
      syntheticRedditConversationFeed,
      't3_synthetic1',
    );

    expect(conversation).toEqual({
      objects: [
        {
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
          body: 'Synthetic delay on the Circle Line. Allow 10 extra minutes.',
        },
        {
          sourceKind: 'reply',
          externalId: 't1_synthetic2',
          threadExternalId: 't3_synthetic1',
          parentExternalId: null,
          subreddit: 'singapore',
          lifecycle: 'active',
          sourceUrl:
            'https://www.reddit.com/r/singapore/comments/synthetic1/fixture/synthetic2/',
          createdAt: '2026-07-18T00:05:00.000Z',
          editedAt: null,
          title: null,
          body: 'Train is still held at one-north.',
        },
        {
          sourceKind: 'reply',
          externalId: 't1_synthetic3',
          threadExternalId: 't3_synthetic1',
          parentExternalId: null,
          subreddit: 'singapore',
          lifecycle: 'removed',
          sourceUrl:
            'https://www.reddit.com/r/singapore/comments/synthetic1/fixture/synthetic3/',
          createdAt: '2026-07-18T00:06:00.000Z',
          editedAt: null,
          title: null,
          body: null,
        },
      ],
      rejectedObjectCount: 0,
      unsupportedObjectCount: 0,
    });
    expect(
      conversation.objects.every(
        (object) => !('author' in object) && object.parentExternalId === null,
      ),
    ).toBe(true);
  });

  it('detects a root rectification edit as a new normalized source body', async () => {
    const editedFeed = editSyntheticRootPost(
      syntheticRedditConversationFeed,
      'Synthetic delay on the Circle Line.&lt;/p&gt;&lt;p&gt;Update: normal service has resumed.',
    );

    const conversation = await parseRedditConversationAtom(
      editedFeed,
      't3_synthetic1',
    );

    expect(conversation.objects[0]).toMatchObject({
      sourceKind: 'post',
      editedAt: '2026-07-18T00:10:00.000Z',
      body: 'Synthetic delay on the Circle Line. Update: normal service has resumed.',
    });
  });

  it('counts malformed replies but rejects a mismatched or unsafe root', async () => {
    const malformedReply = syntheticRedditConversationFeed.replace(
      '/fixture/synthetic2/',
      '/fixture/different/',
    );
    await expect(
      parseRedditConversationAtom(malformedReply, 't3_synthetic1'),
    ).resolves.toMatchObject({ rejectedObjectCount: 1 });

    await expect(
      parseRedditConversationAtom(
        syntheticRedditConversationFeed,
        't3_different',
      ),
    ).rejects.toThrowError(
      new BoundaryValidationError(
        'reddit_conversation_atom',
        'submission_shape',
      ),
    );
    await expect(
      parseRedditConversationAtom('<!DOCTYPE feed><feed />', 't3_synthetic1'),
    ).rejects.toThrowError(
      new BoundaryValidationError('reddit_conversation_atom', 'doctype'),
    );
  });

  it('bounds the full conversation before parsing content', async () => {
    await expect(
      parseRedditConversationAtom(
        'x'.repeat(
          REDDIT_CONVERSATION_ATOM_LIMITS.maximumConversationBytes + 1,
        ),
        't3_synthetic1',
      ),
    ).rejects.toThrowError(
      new BoundaryValidationError(
        'reddit_conversation_atom',
        'conversation_too_large',
      ),
    );
  });
});
