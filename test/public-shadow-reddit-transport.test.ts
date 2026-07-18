import { describe, expect, it } from 'vitest';

import {
  PublicShadowRedditTransport,
  RedditTransportError,
} from '../src/services/public-shadow-reddit-transport.js';
import publicConversationFixture from './fixtures/reddit-public-conversation.json' with {
  type: 'json',
};

const NOW = new Date('2026-07-18T01:00:00Z');
const USER_AGENT = 'mrtdown-reddit-monitor/1.0 (+mailto:ops@example.invalid)';

describe('public-shadow Reddit transport', () => {
  it('uses the single public conversation endpoint with safe cache validators', async () => {
    const capturedRequest = { url: '', headers: new Headers() };
    const transport = new PublicShadowRedditTransport({
      fetch: async (incoming, init) => {
        const request = new Request(incoming, init);
        capturedRequest.url = request.url;
        capturedRequest.headers = request.headers;
        return new Response(JSON.stringify(publicConversationFixture), {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            etag: '"synthetic-etag"',
            'last-modified': 'Fri, 18 Jul 2026 00:59:00 GMT',
            'x-ratelimit-remaining': '99.0',
            'x-ratelimit-reset': '60',
          },
        });
      },
      now: () => NOW,
      userAgent: USER_AGENT,
    });

    const result = await transport.fetchConversation('t3_synthetic1', {
      etag: '"previous-etag"',
      lastModified: 'Fri, 18 Jul 2026 00:00:00 GMT',
    });

    expect(capturedRequest.url).toBe(
      'https://www.reddit.com/comments/synthetic1.json?raw_json=1&limit=100&depth=10',
    );
    expect(capturedRequest.headers.get('user-agent')).toBe(USER_AGENT);
    expect(capturedRequest.headers.get('if-none-match')).toBe(
      '"previous-etag"',
    );
    expect(capturedRequest.headers.get('if-modified-since')).toBe(
      'Fri, 18 Jul 2026 00:00:00 GMT',
    );
    expect(result).toMatchObject({
      kind: 'conversation',
      metadata: {
        etag: '"synthetic-etag"',
        rateLimitRemaining: 99,
        rateLimitResetAt: '2026-07-18T01:01:00.000Z',
      },
    });
  });

  it('returns a cache outcome without attempting to parse a 304 body', async () => {
    const transport = new PublicShadowRedditTransport({
      fetch: async () =>
        new Response(null, { status: 304, headers: { etag: '"same"' } }),
      now: () => NOW,
      userAgent: USER_AGENT,
    });

    await expect(transport.fetchConversation('t3_synthetic1')).resolves.toEqual(
      {
        kind: 'not_modified',
        metadata: expect.objectContaining({ status: 304, etag: '"same"' }),
      },
    );
  });

  it('turns a rate limit response into a safe retry category and metadata', async () => {
    const transport = new PublicShadowRedditTransport({
      fetch: async () =>
        new Response(null, {
          status: 429,
          headers: { 'retry-after': '30', 'x-ratelimit-remaining': '0' },
        }),
      now: () => NOW,
      userAgent: USER_AGENT,
    });

    await expect(transport.fetchConversation('t3_synthetic1')).rejects.toEqual(
      new RedditTransportError('rate_limited', {
        status: 429,
        contentType: null,
        responseBytes: 0,
        etag: null,
        lastModified: null,
        retryAfterAt: '2026-07-18T01:00:30.000Z',
        rateLimitRemaining: 0,
        rateLimitResetAt: null,
      }),
    );
  });

  it('rejects an unexpected content type before parsing its response', async () => {
    const transport = new PublicShadowRedditTransport({
      fetch: async () =>
        new Response('<html>synthetic</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      now: () => NOW,
      userAgent: USER_AGENT,
    });

    await expect(
      transport.fetchConversation('t3_synthetic1'),
    ).rejects.toMatchObject({ category: 'invalid_content_type' });
  });

  it('bounds response bodies while preserving safe retry metadata', async () => {
    const transport = new PublicShadowRedditTransport({
      fetch: async () =>
        new Response('{}', {
          status: 200,
          headers: {
            'content-length': '101',
            'content-type': 'application/json',
            'retry-after': '15',
          },
        }),
      maximumResponseBytes: 100,
      now: () => NOW,
      userAgent: USER_AGENT,
    });

    await expect(
      transport.fetchConversation('t3_synthetic1'),
    ).rejects.toMatchObject({
      category: 'response_too_large',
      metadata: expect.objectContaining({
        retryAfterAt: '2026-07-18T01:00:15.000Z',
        status: 200,
      }),
    });
  });

  it('rejects unsafe request metadata and invalid injected time', async () => {
    const transport = new PublicShadowRedditTransport({
      fetch: async () => new Response(null, { status: 304 }),
      now: () => new Date(Number.NaN),
      userAgent: USER_AGENT,
    });

    await expect(
      transport.fetchConversation('t3_synthetic1', {
        etag: 'unsafe\r\nvalue',
        lastModified: null,
      }),
    ).rejects.toThrowError('Invalid Reddit ETag');
    await expect(
      transport.fetchConversation('t3_synthetic1'),
    ).rejects.toThrowError('Invalid current time');
  });

  it('normalizes malformed JSON without exposing its body', async () => {
    const secretBody = '{"secret":"synthetic-sensitive-value"';
    const transport = new PublicShadowRedditTransport({
      fetch: async () =>
        new Response(secretBody, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      now: () => NOW,
      userAgent: USER_AGENT,
    });

    let caught: unknown;
    try {
      await transport.fetchConversation('t3_synthetic1');
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ category: 'malformed_response' });
    expect(String(caught)).not.toContain(secretBody);
  });
});
