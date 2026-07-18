import { describe, expect, it } from 'vitest';

import {
  REDDIT_SEARCH_ATOM_LIMITS,
  parseRedditSearchAtom,
} from '../src/contracts/reddit-search-atom.js';
import { BoundaryValidationError } from '../src/contracts/validation.js';
import { syntheticRedditSearchFeed } from './fixtures/reddit-search-feed.js';

describe('Reddit search Atom boundary', () => {
  it('extracts only validated thread identities and permalinks', () => {
    expect(
      parseRedditSearchAtom(syntheticRedditSearchFeed, 'singapore'),
    ).toEqual({
      candidates: [
        {
          threadExternalId: 't3_synthetic1',
          subreddit: 'singapore',
          sourceUrl:
            'https://www.reddit.com/r/singapore/comments/synthetic1/fixture/',
        },
        {
          threadExternalId: 't3_synthetic2',
          subreddit: 'singapore',
          sourceUrl:
            'https://www.reddit.com/r/singapore/comments/synthetic2/fixture/',
        },
      ],
      rejectedEntryCount: 0,
      duplicateEntryCount: 0,
    });
  });

  it('counts malformed, cross-subreddit, and repeated entries safely', () => {
    const entries = syntheticRedditSearchFeed.match(
      /<entry>[\s\S]*?<\/entry>/g,
    );
    if (entries === null || entries.length !== 2) {
      throw new Error('Synthetic fixture shape changed');
    }
    const malformed = entries[0]?.replace('/r/singapore/', '/r/askSingapore/');
    const repeated = entries[1]?.replaceAll('synthetic2', 'synthetic1');
    const input = `<?xml version="1.0"?><feed>${malformed}${repeated}${entries[0]}</feed>`;

    expect(parseRedditSearchAtom(input, 'singapore')).toMatchObject({
      candidates: [
        expect.objectContaining({ threadExternalId: 't3_synthetic1' }),
      ],
      rejectedEntryCount: 1,
      duplicateEntryCount: 1,
    });
  });

  it('rejects unsafe XML and oversized input without echoing feed content', () => {
    const unsafe = '<!DOCTYPE feed><feed />';
    expect(() => parseRedditSearchAtom(unsafe, 'singapore')).toThrowError(
      new BoundaryValidationError('reddit_search_atom', 'doctype'),
    );
    expect(() =>
      parseRedditSearchAtom(
        'x'.repeat(REDDIT_SEARCH_ATOM_LIMITS.maximumFeedBytes + 1),
        'singapore',
      ),
    ).toThrowError(
      new BoundaryValidationError('reddit_search_atom', 'feed_too_large'),
    );
  });
});
