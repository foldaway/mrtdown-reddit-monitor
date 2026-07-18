import { fail, isRecord } from './validation.js';

const BOUNDARY = 'reddit_public_json';
const FULLNAME_PATTERN = /^(?:t1|t3)_[a-z0-9]+$/;
const SUBREDDIT_PATTERN = /^[A-Za-z0-9_]{1,21}$/;

export const REDDIT_PUBLIC_JSON_LIMITS = {
  maximumConversationBytes: 512 * 1024,
  maximumObjects: 500,
  maximumNestingDepth: 32,
} as const;

export type RedditSourceLifecycle = 'active' | 'removed' | 'deleted';
export type RedditSourceKind = 'post' | 'reply';

export interface RedditSourceObject {
  sourceKind: RedditSourceKind;
  externalId: string;
  threadExternalId: string;
  parentExternalId: string | null;
  subreddit: string;
  lifecycle: RedditSourceLifecycle;
  sourceUrl: string | null;
  createdAt: string;
  editedAt: string | null;
  title: string | null;
  body: string | null;
}

export interface RedditConversation {
  objects: RedditSourceObject[];
  rejectedObjectCount: number;
  unsupportedObjectCount: number;
}

export function parsePublicRedditConversationJson(
  json: string,
): RedditConversation {
  if (
    new TextEncoder().encode(json).byteLength >
    REDDIT_PUBLIC_JSON_LIMITS.maximumConversationBytes
  ) {
    fail(BOUNDARY, 'conversation_too_large');
  }
  let input: unknown;
  try {
    input = JSON.parse(json);
  } catch {
    fail(BOUNDARY, 'invalid_json');
  }
  return parsePublicRedditConversation(input);
}

export function parsePublicRedditConversation(
  input: unknown,
): RedditConversation {
  if (!Array.isArray(input) || input.length !== 2) {
    fail(BOUNDARY, 'conversation_shape');
  }
  const submissionListing = parseListing(input[0], 'submission_listing');
  const replyListing = parseListing(input[1], 'reply_listing');
  const rootThing = submissionListing.children.at(0);
  if (rootThing === undefined) fail(BOUNDARY, 'missing_submission');
  const root = parseThing(rootThing, null);
  if (root.kind !== 'parsed' || root.parsed.object.sourceKind !== 'post') {
    fail(BOUNDARY, 'submission_shape');
  }

  const objects = [root.parsed.object];
  const counts = { rejected: 0, unsupported: 0 };
  for (const child of submissionListing.children.slice(1)) {
    collectThing(child, root.parsed.object.externalId, 0, objects, counts);
  }
  for (const child of replyListing.children) {
    collectThing(child, root.parsed.object.externalId, 0, objects, counts);
  }

  return {
    objects,
    rejectedObjectCount: counts.rejected,
    unsupportedObjectCount: counts.unsupported,
  };
}

interface Listing {
  children: unknown[];
}

interface ParsedThing {
  object: RedditSourceObject;
  replies: unknown;
}

function parseListing(input: unknown, code: string): Listing {
  const record = assertRecord(input, code);
  if (record.kind !== 'Listing') fail(BOUNDARY, code);
  const data = assertRecord(record.data, code);
  if (!Array.isArray(data.children)) fail(BOUNDARY, code);
  return { children: data.children };
}

function collectThing(
  input: unknown,
  threadExternalId: string,
  depth: number,
  objects: RedditSourceObject[],
  counts: { rejected: number; unsupported: number },
): void {
  if (depth > REDDIT_PUBLIC_JSON_LIMITS.maximumNestingDepth) {
    fail(BOUNDARY, 'conversation_nesting');
  }
  const parsed = parseThing(input, threadExternalId);
  if (parsed.kind === 'unsupported') {
    counts.unsupported += 1;
    return;
  }
  if (parsed.kind === 'malformed') {
    counts.rejected += 1;
    return;
  }
  if (objects.length >= REDDIT_PUBLIC_JSON_LIMITS.maximumObjects) {
    fail(BOUNDARY, 'too_many_objects');
  }
  objects.push(parsed.parsed.object);
  if (parsed.parsed.replies === '') return;
  let listing: Listing;
  try {
    listing = parseListing(parsed.parsed.replies, 'comment_replies');
  } catch {
    counts.rejected += 1;
    return;
  }
  for (const child of listing.children) {
    collectThing(child, threadExternalId, depth + 1, objects, counts);
  }
}

function parseThing(
  input: unknown,
  expectedThreadExternalId: string | null,
):
  | { kind: 'parsed'; parsed: ParsedThing }
  | { kind: 'malformed' }
  | { kind: 'unsupported' } {
  if (!isRecord(input)) return { kind: 'malformed' };
  if (input.kind === 'more') return { kind: 'unsupported' };
  if (input.kind !== 't1' && input.kind !== 't3') {
    return { kind: 'unsupported' };
  }
  if (input.kind === 't3' && expectedThreadExternalId !== null) {
    return { kind: 'malformed' };
  }
  try {
    const data = assertRecord(input.data, 'thing_data');
    return {
      kind: 'parsed',
      parsed: {
        object:
          input.kind === 't3'
            ? parsePost(data)
            : parseReply(data, expectedThreadExternalId),
        replies: input.kind === 't1' ? data.replies : '',
      },
    };
  } catch {
    return { kind: 'malformed' };
  }
}

function parsePost(data: Record<string, unknown>): RedditSourceObject {
  const externalId = parseFullname(data.name, 'post_name', 't3_');
  const lifecycle = parseLifecycle(data.selftext, data.removed_by_category);
  return {
    sourceKind: 'post',
    externalId,
    threadExternalId: externalId,
    parentExternalId: null,
    subreddit: parseSubreddit(data.subreddit),
    lifecycle,
    sourceUrl: lifecycle === 'deleted' ? null : parsePermalink(data.permalink),
    createdAt: parseRedditTimestamp(data.created_utc, 'post_created_at'),
    editedAt: parseEditedTimestamp(data.edited, 'post_edited_at'),
    title: lifecycle === 'active' ? parseText(data.title, 'post_title') : null,
    body: lifecycle === 'active' ? parseText(data.selftext, 'post_body') : null,
  };
}

function parseReply(
  data: Record<string, unknown>,
  expectedThreadExternalId: string | null,
): RedditSourceObject {
  if (expectedThreadExternalId === null) {
    fail(BOUNDARY, 'reply_without_thread');
  }
  const threadExternalId = parseFullname(
    data.link_id,
    'reply_thread_id',
    't3_',
  );
  if (threadExternalId !== expectedThreadExternalId) {
    fail(BOUNDARY, 'reply_thread_id');
  }
  const lifecycle = parseLifecycle(data.body, data.removed_by_category);
  return {
    sourceKind: 'reply',
    externalId: parseFullname(data.name, 'reply_name', 't1_'),
    threadExternalId,
    parentExternalId: parseFullname(data.parent_id, 'reply_parent_id'),
    subreddit: parseSubreddit(data.subreddit),
    lifecycle,
    sourceUrl: lifecycle === 'deleted' ? null : parsePermalink(data.permalink),
    createdAt: parseRedditTimestamp(data.created_utc, 'reply_created_at'),
    editedAt: parseEditedTimestamp(data.edited, 'reply_edited_at'),
    title: null,
    body: lifecycle === 'active' ? parseText(data.body, 'reply_body') : null,
  };
}

function parseLifecycle(
  content: unknown,
  removedByCategory: unknown,
): RedditSourceLifecycle {
  if (content === '[deleted]') return 'deleted';
  if (content === '[removed]') return 'removed';
  if (removedByCategory !== null && typeof removedByCategory !== 'string') {
    fail(BOUNDARY, 'removed_state');
  }
  return typeof removedByCategory === 'string' ? 'removed' : 'active';
}

function parseFullname(
  value: unknown,
  code: string,
  prefix?: 't1_' | 't3_',
): string {
  const fullname = parseText(value, code);
  if (
    !FULLNAME_PATTERN.test(fullname) ||
    (prefix !== undefined && !fullname.startsWith(prefix))
  ) {
    fail(BOUNDARY, code);
  }
  return fullname;
}

function parseSubreddit(value: unknown): string {
  const subreddit = parseText(value, 'subreddit');
  if (!SUBREDDIT_PATTERN.test(subreddit)) fail(BOUNDARY, 'subreddit');
  return subreddit;
}

function parsePermalink(value: unknown): string {
  const permalink = parseText(value, 'permalink');
  if (
    !permalink.startsWith('/r/') ||
    permalink.includes('?') ||
    permalink.includes('#')
  ) {
    fail(BOUNDARY, 'permalink');
  }
  return `https://www.reddit.com${permalink}`;
}

function parseRedditTimestamp(value: unknown, code: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    fail(BOUNDARY, code);
  }
  const timestamp = new Date(value * 1_000);
  if (Number.isNaN(timestamp.valueOf())) fail(BOUNDARY, code);
  return timestamp.toISOString();
}

function parseEditedTimestamp(value: unknown, code: string): string | null {
  if (value === false) return null;
  return parseRedditTimestamp(value, code);
}

function parseText(value: unknown, code: string): string {
  if (typeof value !== 'string') fail(BOUNDARY, code);
  return value;
}

function assertRecord(input: unknown, code: string): Record<string, unknown> {
  if (!isRecord(input)) fail(BOUNDARY, code);
  return input;
}
