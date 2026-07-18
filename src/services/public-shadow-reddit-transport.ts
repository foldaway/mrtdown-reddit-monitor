import {
  REDDIT_CONVERSATION_ATOM_LIMITS,
  parseRedditConversationAtom,
} from '../contracts/reddit-conversation-atom.js';
import type { RedditConversation } from '../contracts/reddit-source.js';
import {
  REDDIT_SEARCH_ATOM_LIMITS,
  type RedditSearchFeed,
  parseRedditSearchAtom,
} from '../contracts/reddit-search-atom.js';

const THREAD_FULLNAME_PATTERN = /^t3_([a-z0-9]+)$/;
const SUBREDDIT_PATTERN = /^[A-Za-z0-9_]{1,21}$/;
const MAXIMUM_HEADER_VALUE_BYTES = 512;
const MAXIMUM_USER_AGENT_BYTES = 256;
const MAXIMUM_DISCOVERY_QUERY_BYTES = 500;

export interface RedditCacheValidators {
  etag: string | null;
  lastModified: string | null;
}

export interface RedditResponseMetadata extends RedditCacheValidators {
  status: number;
  contentType: string | null;
  responseBytes: number;
  retryAfterAt: string | null;
  rateLimitRemaining: number | null;
  rateLimitResetAt: string | null;
}

export type PublicConversationFetchResult =
  | { kind: 'not_modified'; metadata: RedditResponseMetadata }
  | {
      kind: 'conversation';
      conversation: RedditConversation;
      metadata: RedditResponseMetadata;
    };

export interface PublicShadowRedditTransportOptions {
  fetch: typeof fetch;
  userAgent: string;
  now: () => Date;
  maximumResponseBytes?: number;
}

export interface PublicShadowRedditDiscoveryTransportOptions {
  fetch: typeof fetch;
  userAgent: string;
  now: () => Date;
  maximumResponseBytes?: number;
}

export interface PublicDiscoveryFetchResult {
  feed: RedditSearchFeed;
  metadata: RedditResponseMetadata;
}

export class RedditTransportError extends Error {
  constructor(
    readonly category:
      | 'authentication'
      | 'blocked'
      | 'invalid_content_type'
      | 'malformed_response'
      | 'network'
      | 'rate_limited'
      | 'response_too_large'
      | 'unexpected_status',
    readonly metadata: RedditResponseMetadata | null,
  ) {
    super(`Reddit transport failed: ${category}`);
    this.name = 'RedditTransportError';
  }
}

/**
 * Temporary bounded transport for conversations selected by shadow discovery.
 * It intentionally uses one public origin and has no fallback behavior.
 */
export class PublicShadowRedditTransport {
  private readonly maximumResponseBytes: number;

  constructor(private readonly options: PublicShadowRedditTransportOptions) {
    assertSafeHeaderValue(
      options.userAgent,
      'Reddit user agent',
      MAXIMUM_USER_AGENT_BYTES,
    );
    this.maximumResponseBytes =
      options.maximumResponseBytes ??
      REDDIT_CONVERSATION_ATOM_LIMITS.maximumConversationBytes;
    if (
      !Number.isSafeInteger(this.maximumResponseBytes) ||
      this.maximumResponseBytes < 1 ||
      this.maximumResponseBytes >
        REDDIT_CONVERSATION_ATOM_LIMITS.maximumConversationBytes
    ) {
      throw new TypeError('Invalid maximum response bytes');
    }
  }

  async fetchConversation(
    threadExternalId: string,
    validators: RedditCacheValidators = { etag: null, lastModified: null },
  ): Promise<PublicConversationFetchResult> {
    const threadId = parseThreadExternalId(threadExternalId);
    const request = new Request(createConversationUrl(threadId), {
      headers: createRequestHeaders(this.options.userAgent, validators),
      redirect: 'manual',
    });

    let response: Response;
    try {
      response = await this.options.fetch(request);
    } catch {
      throw new RedditTransportError('network', null);
    }

    const metadata = parseMetadata(response, readCurrentTime(this.options.now));
    if (response.status === 304) return { kind: 'not_modified', metadata };
    if (response.status !== 200) {
      throw new RedditTransportError(statusCategory(response.status), metadata);
    }
    if (!isAtomContentType(metadata.contentType)) {
      throw new RedditTransportError('invalid_content_type', metadata);
    }

    let xml: string;
    try {
      xml = await readBoundedBody(
        response,
        this.maximumResponseBytes,
        metadata,
      );
    } catch (error) {
      if (error instanceof RedditTransportError) throw error;
      throw new RedditTransportError('malformed_response', metadata);
    }

    const responseBytes = new TextEncoder().encode(xml).byteLength;
    const parsedMetadata = { ...metadata, responseBytes };
    try {
      return {
        kind: 'conversation',
        conversation: await parseRedditConversationAtom(xml, threadExternalId),
        metadata: parsedMetadata,
      };
    } catch {
      throw new RedditTransportError('malformed_response', parsedMetadata);
    }
  }
}

/**
 * Temporary bounded transport for the proven public Reddit search feeds.
 * The search feed contributes candidate identities only; the selected post's
 * Atom feed remains authoritative for source content.
 */
export class PublicShadowRedditDiscoveryTransport {
  private readonly maximumResponseBytes: number;

  constructor(
    private readonly options: PublicShadowRedditDiscoveryTransportOptions,
  ) {
    assertSafeHeaderValue(
      options.userAgent,
      'Reddit user agent',
      MAXIMUM_USER_AGENT_BYTES,
    );
    this.maximumResponseBytes =
      options.maximumResponseBytes ??
      REDDIT_SEARCH_ATOM_LIMITS.maximumFeedBytes;
    if (
      !Number.isSafeInteger(this.maximumResponseBytes) ||
      this.maximumResponseBytes < 1 ||
      this.maximumResponseBytes > REDDIT_SEARCH_ATOM_LIMITS.maximumFeedBytes
    ) {
      throw new TypeError('Invalid maximum response bytes');
    }
  }

  async fetchCandidates(
    subreddit: string,
    query: string,
  ): Promise<PublicDiscoveryFetchResult> {
    validateDiscoveryInput(subreddit, query);
    const request = new Request(createDiscoveryUrl(subreddit, query), {
      headers: {
        Accept: 'application/atom+xml, application/xml;q=0.9',
        'User-Agent': this.options.userAgent,
      },
      redirect: 'manual',
    });

    let response: Response;
    try {
      response = await this.options.fetch(request);
    } catch {
      throw new RedditTransportError('network', null);
    }

    const metadata = parseMetadata(response, readCurrentTime(this.options.now));
    if (response.status !== 200) {
      throw new RedditTransportError(statusCategory(response.status), metadata);
    }
    if (!isAtomContentType(metadata.contentType)) {
      throw new RedditTransportError('invalid_content_type', metadata);
    }

    let xml: string;
    try {
      xml = await readBoundedBody(
        response,
        this.maximumResponseBytes,
        metadata,
      );
    } catch (error) {
      if (error instanceof RedditTransportError) throw error;
      throw new RedditTransportError('malformed_response', metadata);
    }

    const parsedMetadata = {
      ...metadata,
      responseBytes: new TextEncoder().encode(xml).byteLength,
    };
    try {
      return {
        feed: parseRedditSearchAtom(xml, subreddit),
        metadata: parsedMetadata,
      };
    } catch {
      throw new RedditTransportError('malformed_response', parsedMetadata);
    }
  }
}

function createConversationUrl(threadId: string): string {
  const url = new URL(`https://www.reddit.com/comments/${threadId}/.rss`);
  url.searchParams.set('sort', 'new');
  url.searchParams.set('limit', '500');
  return url.toString();
}

function createDiscoveryUrl(subreddit: string, query: string): string {
  const url = new URL(`https://www.reddit.com/r/${subreddit}/search.rss`);
  url.searchParams.set('q', query);
  url.searchParams.set('restrict_sr', 'on');
  url.searchParams.set('sort', 'new');
  return url.toString();
}

function createRequestHeaders(
  userAgent: string,
  validators: RedditCacheValidators,
): Headers {
  const headers = new Headers({
    Accept: 'application/atom+xml, application/xml;q=0.9',
    'User-Agent': userAgent,
  });
  if (validators.etag !== null) {
    assertSafeHeaderValue(
      validators.etag,
      'Reddit ETag',
      MAXIMUM_HEADER_VALUE_BYTES,
    );
    headers.set('If-None-Match', validators.etag);
  }
  if (validators.lastModified !== null) {
    assertSafeHeaderValue(
      validators.lastModified,
      'Reddit Last-Modified value',
      MAXIMUM_HEADER_VALUE_BYTES,
    );
    headers.set('If-Modified-Since', validators.lastModified);
  }
  return headers;
}

function parseThreadExternalId(threadExternalId: string): string {
  const match = threadExternalId.match(THREAD_FULLNAME_PATTERN);
  const threadId = match?.[1];
  if (threadId === undefined) throw new TypeError('Invalid thread external ID');
  return threadId;
}

function validateDiscoveryInput(subreddit: string, query: string): void {
  if (!SUBREDDIT_PATTERN.test(subreddit)) {
    throw new TypeError('Invalid subreddit');
  }
  assertSafeHeaderValue(
    query,
    'Reddit discovery query',
    MAXIMUM_DISCOVERY_QUERY_BYTES,
  );
}

function assertSafeHeaderValue(
  value: unknown,
  label: string,
  maximumBytes: number,
): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    /[\r\n]/.test(value) ||
    new TextEncoder().encode(value).byteLength > maximumBytes
  ) {
    throw new TypeError(`Invalid ${label}`);
  }
}

function readCurrentTime(now: () => Date): Date {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) {
    throw new TypeError('Invalid current time');
  }
  return value;
}

function parseMetadata(response: Response, now: Date): RedditResponseMetadata {
  const contentType = readBoundedHeader(response, 'content-type');
  const contentLength = parseContentLength(
    readBoundedHeader(response, 'content-length'),
  );
  const retryAfterAt = parseRetryAfter(
    readBoundedHeader(response, 'retry-after'),
    now,
  );
  const remaining = parseNonNegativeNumber(
    readBoundedHeader(response, 'x-ratelimit-remaining'),
  );
  const resetSeconds = parseNonNegativeNumber(
    readBoundedHeader(response, 'x-ratelimit-reset'),
  );
  return {
    status: response.status,
    contentType,
    responseBytes: contentLength ?? 0,
    etag: readBoundedHeader(response, 'etag'),
    lastModified: readBoundedHeader(response, 'last-modified'),
    retryAfterAt,
    rateLimitRemaining: remaining,
    rateLimitResetAt:
      resetSeconds === null ? null : addSecondsToTimestamp(now, resetSeconds),
  };
}

async function readBoundedBody(
  response: Response,
  maximumBytes: number,
  metadata: RedditResponseMetadata,
): Promise<string> {
  const contentLength = parseContentLength(
    readBoundedHeader(response, 'content-length'),
  );
  if (contentLength !== null && contentLength > maximumBytes) {
    throw new RedditTransportError('response_too_large', metadata);
  }
  if (response.body === null) throw new Error('empty_response');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new RedditTransportError('response_too_large', metadata);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(body);
}

function readBoundedHeader(response: Response, name: string): string | null {
  const value = response.headers.get(name);
  if (
    value === null ||
    new TextEncoder().encode(value).byteLength > MAXIMUM_HEADER_VALUE_BYTES
  ) {
    return null;
  }
  return value;
}

function parseContentLength(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseRetryAfter(value: string | null, now: Date): string | null {
  if (value === null) return null;
  if (/^\d+$/.test(value)) {
    return addSecondsToTimestamp(now, Number(value));
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= now.valueOf()
    ? new Date(parsed).toISOString()
    : null;
}

function addSecondsToTimestamp(now: Date, seconds: number): string | null {
  const timestamp = now.valueOf() + seconds * 1_000;
  return Number.isFinite(timestamp) && timestamp <= 8_640_000_000_000_000
    ? new Date(timestamp).toISOString()
    : null;
}

function parseNonNegativeNumber(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function isAtomContentType(contentType: string | null): boolean {
  return (
    contentType !== null &&
    /^(?:application\/(?:atom\+xml|rss\+xml|xml)|text\/xml)(?:\s*;|$)/i.test(
      contentType,
    )
  );
}

function statusCategory(status: number): RedditTransportError['category'] {
  if (status === 401) return 'authentication';
  if (status === 403) return 'blocked';
  if (status === 429) return 'rate_limited';
  return 'unexpected_status';
}
