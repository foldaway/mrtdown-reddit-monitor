import { describe, expect, it } from 'vitest';

import publicConversationFixture from '../../test/fixtures/reddit-public-conversation.json' with {
  type: 'json',
};
import { parsePublicRedditConversation } from './reddit-public-json.js';
import { BoundaryValidationError } from './validation.js';

interface MutableThing {
  kind: string;
  data: Record<string, unknown>;
}

interface MutableListing {
  kind: string;
  data: { children: MutableThing[] };
}

function cloneFixture(): MutableListing[] {
  return structuredClone(
    publicConversationFixture,
  ) as unknown as MutableListing[];
}

describe('Reddit public conversation boundary', () => {
  it('normalizes synthetic lifecycle data without exposing authors', () => {
    const parsed = parsePublicRedditConversation(publicConversationFixture);

    expect(parsed).toMatchObject({
      rejectedObjectCount: 0,
      unsupportedObjectCount: 1,
    });
    expect(parsed.objects).toEqual([
      expect.objectContaining({
        sourceKind: 'post',
        externalId: 't3_synthetic1',
        lifecycle: 'active',
      }),
      expect.objectContaining({
        sourceKind: 'reply',
        externalId: 't1_synthetic2',
        lifecycle: 'removed',
        title: null,
        body: null,
      }),
      expect.objectContaining({
        sourceKind: 'reply',
        externalId: 't1_synthetic3',
        lifecycle: 'deleted',
        sourceUrl: null,
        title: null,
        body: null,
      }),
    ]);
    expect(parsed.objects.every((object) => !('author' in object))).toBe(true);
  });

  it('counts malformed replies instead of passing guessed data downstream', () => {
    const input = cloneFixture();
    const listing = input[1];
    const reply = listing?.data.children[0];
    if (reply?.kind !== 't1') {
      throw new Error('Synthetic fixture shape changed');
    }
    reply.data.parent_id = 'not-a-fullname';

    const parsed = parsePublicRedditConversation(input);
    expect(parsed).toMatchObject({
      rejectedObjectCount: 1,
      unsupportedObjectCount: 1,
    });
    expect(parsed.objects.map(({ externalId }) => externalId)).not.toContain(
      't1_synthetic2',
    );
  });

  it('rejects malformed roots without including source content in errors', () => {
    const input = cloneFixture();
    const listing = input[0];
    const submission = listing?.data.children[0];
    if (submission?.kind !== 't3') {
      throw new Error('Synthetic fixture shape changed');
    }
    submission.data.name = 'source-body-must-not-appear';

    expect(() => parsePublicRedditConversation(input)).toThrowError(
      new BoundaryValidationError('reddit_public_json', 'submission_shape'),
    );
  });
});
