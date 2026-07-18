import { XMLParser, XMLValidator } from 'fast-xml-parser';

import { fail, isRecord } from './validation.js';

const BOUNDARY = 'reddit_search_atom';
const FULLNAME_PATTERN = /^t3_([a-z0-9]+)$/;
const SUBREDDIT_PATTERN = /^[A-Za-z0-9_]{1,21}$/;
const REDDIT_ORIGINS = new Set([
  'https://reddit.com',
  'https://www.reddit.com',
]);

export const REDDIT_SEARCH_ATOM_LIMITS = {
  maximumFeedBytes: 256 * 1024,
  maximumEntries: 100,
  maximumNestingDepth: 32,
} as const;

export interface RedditDiscoveryCandidate {
  threadExternalId: string;
  subreddit: string;
  sourceUrl: string;
}

export interface RedditSearchFeed {
  candidates: RedditDiscoveryCandidate[];
  rejectedEntryCount: number;
  duplicateEntryCount: number;
}

const parser = new XMLParser({
  allowBooleanAttributes: false,
  attributeNamePrefix: '',
  ignoreAttributes: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  maxNestedTags: REDDIT_SEARCH_ATOM_LIMITS.maximumNestingDepth,
  parseAttributeValue: false,
  parseTagValue: false,
  processEntities: {
    enabled: true,
    maxEntityCount: 10,
    maxEntitySize: 256,
    maxExpandedLength: 2_048,
    maxExpansionDepth: 2,
    maxTotalExpansions: 100,
  },
  removeNSPrefix: true,
  trimValues: true,
});

export function parseRedditSearchAtom(
  xml: string,
  expectedSubreddit: string,
): RedditSearchFeed {
  validateExpectedSubreddit(expectedSubreddit);
  if (
    new TextEncoder().encode(xml).byteLength >
    REDDIT_SEARCH_ATOM_LIMITS.maximumFeedBytes
  ) {
    fail(BOUNDARY, 'feed_too_large');
  }
  if (/<!DOCTYPE(?:\s|>)/i.test(xml)) fail(BOUNDARY, 'doctype');
  if (XMLValidator.validate(xml) !== true) fail(BOUNDARY, 'invalid_xml');

  let input: unknown;
  try {
    input = parser.parse(xml);
  } catch {
    fail(BOUNDARY, 'invalid_xml');
  }
  if (!isRecord(input) || !isRecord(input.feed)) {
    fail(BOUNDARY, 'feed_shape');
  }

  const entries = toArray(input.feed.entry);
  if (entries.length > REDDIT_SEARCH_ATOM_LIMITS.maximumEntries) {
    fail(BOUNDARY, 'too_many_entries');
  }

  const candidates: RedditDiscoveryCandidate[] = [];
  const seen = new Set<string>();
  let rejectedEntryCount = 0;
  let duplicateEntryCount = 0;
  for (const entry of entries) {
    try {
      const candidate = parseEntry(entry, expectedSubreddit);
      if (seen.has(candidate.threadExternalId)) {
        duplicateEntryCount += 1;
        continue;
      }
      seen.add(candidate.threadExternalId);
      candidates.push(candidate);
    } catch {
      rejectedEntryCount += 1;
    }
  }

  return { candidates, rejectedEntryCount, duplicateEntryCount };
}

function parseEntry(
  input: unknown,
  expectedSubreddit: string,
): RedditDiscoveryCandidate {
  if (!isRecord(input) || typeof input.id !== 'string') {
    fail(BOUNDARY, 'entry_shape');
  }
  const match = input.id.match(FULLNAME_PATTERN);
  const redditId = match?.[1];
  if (redditId === undefined) fail(BOUNDARY, 'entry_id');

  const sourceUrl = parseEntryUrl(input.link, expectedSubreddit, redditId);
  return {
    threadExternalId: input.id,
    subreddit: expectedSubreddit,
    sourceUrl,
  };
}

function parseEntryUrl(
  input: unknown,
  expectedSubreddit: string,
  expectedRedditId: string,
): string {
  const links = toArray(input);
  const alternate = links.find(
    (link) =>
      isRecord(link) &&
      typeof link.href === 'string' &&
      (link.rel === undefined || link.rel === 'alternate'),
  );
  if (!isRecord(alternate) || typeof alternate.href !== 'string') {
    fail(BOUNDARY, 'entry_link');
  }

  let url: URL;
  try {
    url = new URL(alternate.href);
  } catch {
    fail(BOUNDARY, 'entry_link');
  }
  if (
    !REDDIT_ORIGINS.has(url.origin) ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    fail(BOUNDARY, 'entry_link');
  }
  const pathMatch = url.pathname.match(
    /^\/r\/([A-Za-z0-9_]{1,21})\/comments\/([a-z0-9]+)(?:\/|$)/,
  );
  if (
    pathMatch?.[1]?.toLowerCase() !== expectedSubreddit.toLowerCase() ||
    pathMatch[2] !== expectedRedditId
  ) {
    fail(BOUNDARY, 'entry_link');
  }
  return url.toString();
}

function validateExpectedSubreddit(subreddit: string): void {
  if (!SUBREDDIT_PATTERN.test(subreddit)) fail(BOUNDARY, 'subreddit');
}

function toArray(input: unknown): unknown[] {
  if (input === undefined) return [];
  return Array.isArray(input) ? input : [input];
}
