import { XMLParser, XMLValidator } from 'fast-xml-parser';

import type {
  RedditConversation,
  RedditSourceLifecycle,
  RedditSourceObject,
} from './reddit-source.js';
import { fail, isRecord } from './validation.js';

const BOUNDARY = 'reddit_conversation_atom';
const THREAD_FULLNAME_PATTERN = /^t3_([a-z0-9]+)$/;
const REPLY_FULLNAME_PATTERN = /^t1_([a-z0-9]+)$/;
const SUBREDDIT_PATTERN = /^[A-Za-z0-9_]{1,21}$/;
const REDDIT_ORIGINS = new Set([
  'https://reddit.com',
  'https://www.reddit.com',
]);
const MAXIMUM_TITLE_BYTES = 1_024;
const MAXIMUM_SOURCE_TEXT_BYTES = 64 * 1024;

export const REDDIT_CONVERSATION_ATOM_LIMITS = {
  maximumConversationBytes: 512 * 1024,
  maximumObjects: 501,
  maximumNestingDepth: 32,
} as const;

const parser = new XMLParser({
  allowBooleanAttributes: false,
  attributeNamePrefix: '',
  ignoreAttributes: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
  maxNestedTags: REDDIT_CONVERSATION_ATOM_LIMITS.maximumNestingDepth,
  parseAttributeValue: false,
  parseTagValue: false,
  processEntities: {
    enabled: true,
    maxEntityCount: 10,
    maxEntitySize: 256,
    maxExpandedLength: REDDIT_CONVERSATION_ATOM_LIMITS.maximumConversationBytes,
    maxExpansionDepth: 2,
    maxTotalExpansions: 50_000,
  },
  removeNSPrefix: true,
  trimValues: true,
});

export async function parseRedditConversationAtom(
  xml: string,
  expectedThreadExternalId: string,
): Promise<RedditConversation> {
  const expectedRedditId = parseThreadExternalId(expectedThreadExternalId);
  if (
    new TextEncoder().encode(xml).byteLength >
    REDDIT_CONVERSATION_ATOM_LIMITS.maximumConversationBytes
  ) {
    fail(BOUNDARY, 'conversation_too_large');
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
  if (entries.length > REDDIT_CONVERSATION_ATOM_LIMITS.maximumObjects) {
    fail(BOUNDARY, 'too_many_objects');
  }

  const rootEntries = entries.filter(
    (entry) => isRecord(entry) && entry.id === expectedThreadExternalId,
  );
  if (rootEntries.length !== 1) fail(BOUNDARY, 'submission_shape');
  const root = await parsePost(rootEntries[0], expectedRedditId);

  const objects: RedditSourceObject[] = [root];
  const seen = new Set([root.externalId]);
  let rejectedObjectCount = 0;
  for (const entry of entries) {
    if (entry === rootEntries[0]) continue;
    try {
      const reply = await parseReply(
        entry,
        expectedThreadExternalId,
        expectedRedditId,
        root.subreddit,
      );
      if (seen.has(reply.externalId)) {
        rejectedObjectCount += 1;
        continue;
      }
      seen.add(reply.externalId);
      objects.push(reply);
    } catch {
      rejectedObjectCount += 1;
    }
  }

  return { objects, rejectedObjectCount, unsupportedObjectCount: 0 };
}

async function parsePost(
  input: unknown,
  expectedRedditId: string,
): Promise<RedditSourceObject> {
  const entry = requireRecord(input, 'submission_shape');
  const externalId = requireText(entry.id, 'submission_id');
  if (externalId !== `t3_${expectedRedditId}`) {
    fail(BOUNDARY, 'submission_id');
  }
  const parsedUrl = parseEntryUrl(entry.link, expectedRedditId, null);
  const categorySubreddit = parseCategorySubreddit(entry.category);
  if (
    categorySubreddit !== null &&
    categorySubreddit.toLowerCase() !== parsedUrl.subreddit.toLowerCase()
  ) {
    fail(BOUNDARY, 'submission_subreddit');
  }
  const publishedAt = parseTimestamp(entry.published, 'submission_published');
  const updatedAt = parseTimestamp(entry.updated, 'submission_updated');
  const extractedBody = await extractMarkdownBody(entry.content);
  const body = extractedBody ?? '';
  const lifecycle = parseLifecycle(body);
  return {
    sourceKind: 'post',
    externalId,
    threadExternalId: externalId,
    parentExternalId: null,
    subreddit: parsedUrl.subreddit,
    lifecycle,
    sourceUrl: lifecycle === 'deleted' ? null : parsedUrl.sourceUrl,
    createdAt: publishedAt,
    editedAt: updatedAt === publishedAt ? null : updatedAt,
    title:
      lifecycle === 'active'
        ? requireBoundedText(
            entry.title,
            'submission_title',
            MAXIMUM_TITLE_BYTES,
          )
        : null,
    body: lifecycle === 'active' ? body : null,
  };
}

async function parseReply(
  input: unknown,
  expectedThreadExternalId: string,
  expectedRedditId: string,
  expectedSubreddit: string,
): Promise<RedditSourceObject> {
  const entry = requireRecord(input, 'reply_shape');
  const externalId = requireText(entry.id, 'reply_id');
  const match = externalId.match(REPLY_FULLNAME_PATTERN);
  const replyRedditId = match?.[1];
  if (replyRedditId === undefined) fail(BOUNDARY, 'reply_id');
  const parsedUrl = parseEntryUrl(entry.link, expectedRedditId, replyRedditId);
  if (parsedUrl.subreddit.toLowerCase() !== expectedSubreddit.toLowerCase()) {
    fail(BOUNDARY, 'reply_subreddit');
  }
  const categorySubreddit = parseCategorySubreddit(entry.category);
  if (
    categorySubreddit !== null &&
    categorySubreddit.toLowerCase() !== expectedSubreddit.toLowerCase()
  ) {
    fail(BOUNDARY, 'reply_subreddit');
  }
  const body = await extractMarkdownBody(entry.content);
  if (body === null || body.length === 0) fail(BOUNDARY, 'reply_body');
  const lifecycle = parseLifecycle(body);
  return {
    sourceKind: 'reply',
    externalId,
    threadExternalId: expectedThreadExternalId,
    parentExternalId: null,
    subreddit: expectedSubreddit,
    lifecycle,
    sourceUrl: lifecycle === 'deleted' ? null : parsedUrl.sourceUrl,
    createdAt: parseTimestamp(entry.updated, 'reply_updated'),
    editedAt: null,
    title: null,
    body: lifecycle === 'active' ? body : null,
  };
}

async function extractMarkdownBody(input: unknown): Promise<string | null> {
  if (!isRecord(input) || input.type !== 'html') {
    fail(BOUNDARY, 'entry_content');
  }
  const html = input['#text'];
  if (typeof html !== 'string') fail(BOUNDARY, 'entry_content');

  let foundMarkdown = false;
  const chunks: string[] = [];
  try {
    const transformed = new HTMLRewriter()
      .on('div.md', {
        element() {
          foundMarkdown = true;
        },
        text(text) {
          chunks.push(text.text);
          if (text.lastInTextNode) chunks.push(' ');
        },
      })
      .transform(
        new Response(html, {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
      );
    await transformed.arrayBuffer();
  } catch {
    fail(BOUNDARY, 'entry_content');
  }
  if (!foundMarkdown) return null;
  const normalized = chunks.join('').replace(/\s+/g, ' ').trim();
  if (
    new TextEncoder().encode(normalized).byteLength > MAXIMUM_SOURCE_TEXT_BYTES
  ) {
    fail(BOUNDARY, 'source_text_too_large');
  }
  return normalized;
}

function parseEntryUrl(
  input: unknown,
  expectedThreadRedditId: string,
  expectedReplyRedditId: string | null,
): { sourceUrl: string; subreddit: string } {
  const link = toArray(input).find(
    (candidate) => isRecord(candidate) && typeof candidate.href === 'string',
  );
  if (!isRecord(link) || typeof link.href !== 'string') {
    fail(BOUNDARY, 'entry_link');
  }
  let url: URL;
  try {
    url = new URL(link.href);
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
  const segments = url.pathname.split('/').filter((segment) => segment !== '');
  const subreddit = segments[1];
  const hasExpectedShape =
    expectedReplyRedditId === null
      ? segments.length === 4 || segments.length === 5
      : segments.length === 6 && segments[5] === expectedReplyRedditId;
  if (
    segments[0] !== 'r' ||
    subreddit === undefined ||
    !SUBREDDIT_PATTERN.test(subreddit) ||
    segments[2] !== 'comments' ||
    segments[3] !== expectedThreadRedditId ||
    !hasExpectedShape
  ) {
    fail(BOUNDARY, 'entry_link');
  }
  return { sourceUrl: url.toString(), subreddit };
}

function parseCategorySubreddit(input: unknown): string | null {
  const category = toArray(input).find(
    (candidate) => isRecord(candidate) && typeof candidate.term === 'string',
  );
  if (category === undefined) return null;
  if (!isRecord(category) || typeof category.term !== 'string') {
    fail(BOUNDARY, 'entry_category');
  }
  if (!SUBREDDIT_PATTERN.test(category.term)) {
    fail(BOUNDARY, 'entry_category');
  }
  return category.term;
}

function parseLifecycle(body: string): RedditSourceLifecycle {
  if (body === '[deleted]') return 'deleted';
  if (body === '[removed]') return 'removed';
  return 'active';
}

function parseThreadExternalId(threadExternalId: string): string {
  const match = threadExternalId.match(THREAD_FULLNAME_PATTERN);
  const redditId = match?.[1];
  if (redditId === undefined) fail(BOUNDARY, 'thread_id');
  return redditId;
}

function parseTimestamp(input: unknown, code: string): string {
  const value = requireText(input, code);
  if (
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    fail(BOUNDARY, code);
  }
  return new Date(value).toISOString();
}

function requireBoundedText(
  input: unknown,
  code: string,
  maximumBytes: number,
): string {
  const value = requireText(input, code).trim();
  if (
    value.length === 0 ||
    new TextEncoder().encode(value).byteLength > maximumBytes
  ) {
    fail(BOUNDARY, code);
  }
  return value;
}

function requireText(input: unknown, code: string): string {
  if (typeof input !== 'string') fail(BOUNDARY, code);
  return input;
}

function requireRecord(input: unknown, code: string): Record<string, unknown> {
  if (!isRecord(input)) fail(BOUNDARY, code);
  return input;
}

function toArray(input: unknown): unknown[] {
  if (input === undefined) return [];
  return Array.isArray(input) ? input : [input];
}
