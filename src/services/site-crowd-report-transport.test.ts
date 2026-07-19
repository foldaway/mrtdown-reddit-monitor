import { describe, expect, it, vi } from 'vitest';

import type { CrowdReportDeliveryRequest } from '../contracts/site.js';
import {
  SiteCrowdReportTransport,
  SiteDeliveryError,
} from './site-crowd-report-transport.js';

const NOW = new Date('2026-07-19T01:00:00.000Z');
const request: CrowdReportDeliveryRequest = {
  externalReportId: 'reddit.synthetic-report',
  sourceUrl: 'https://www.reddit.com/r/singapore/comments/synthetic1/fixture/',
  report: {
    reportScope: 'line',
    observedAt: NOW.toISOString(),
    lineIds: ['CCL'],
    stationIds: [],
    effect: 'delay',
    isStillHappening: true,
  },
};

function transport(fetch: typeof globalThis.fetch) {
  return new SiteCrowdReportTransport({
    fetch,
    ingestUrl: 'https://example.invalid/internal/api/crowd-reports',
    ingestToken: 'synthetic-secret',
    now: () => NOW,
  });
}

describe('site crowd-report transport', () => {
  it('posts an authenticated bounded request and validates a 202 response', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const outbound = new Request(input);
      expect(outbound.method).toBe('POST');
      expect(outbound.redirect).toBe('manual');
      expect(outbound.headers.get('authorization')).toBe(
        'Bearer synthetic-secret',
      );
      expect(outbound.headers.get('content-type')).toBe('application/json');
      await expect(outbound.json()).resolves.toEqual(request);
      return Response.json(
        {
          success: true,
          data: {
            id: 'site-report-1',
            status: 'accepted',
            duplicateOfId: null,
            idempotentReplay: false,
          },
        },
        { status: 202 },
      );
    });

    await expect(transport(fetch).deliver(request)).resolves.toEqual({
      reportId: 'site-report-1',
      moderationStatus: 'accepted',
    });
  });

  it.each([
    [400, 'invalid_request', false],
    [401, 'authentication', false],
    [409, 'idempotency_conflict', false],
    [429, 'rate_limited', true],
    [503, 'server', true],
  ] as const)('normalizes HTTP %i without reading an untrusted body', async (status, category, retryable) => {
    const fetch = vi.fn(
      async () =>
        new Response('untrusted upstream body', {
          status,
          headers: { 'retry-after': '60' },
        }),
    );

    await expect(transport(fetch).deliver(request)).rejects.toMatchObject({
      category,
      retryable,
      status,
      ...(retryable
        ? { retryAt: '2026-07-19T01:01:00.000Z' }
        : { retryAt: null }),
    });
  });

  it('normalizes network and invalid accepted responses without source data', async () => {
    await expect(
      transport(
        vi.fn().mockRejectedValue(new Error('secret network detail')),
      ).deliver(request),
    ).rejects.toEqual(new SiteDeliveryError('network', true, null));

    const invalidFetch = vi.fn(
      async () =>
        new Response('{invalid', {
          status: 202,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const error = await transport(invalidFetch)
      .deliver(request)
      .catch((caught: unknown) => caught);
    expect(error).toEqual(new SiteDeliveryError('invalid_response', true, 202));
    expect(String(error)).not.toContain('secret network detail');
    expect(String(error)).not.toContain(request.externalReportId);
  });

  it('rejects oversized accepted responses before parsing them', async () => {
    const fetch = vi.fn(
      async () =>
        new Response('{}', {
          status: 202,
          headers: {
            'content-length': '100',
            'content-type': 'application/json',
          },
        }),
    );
    const bounded = new SiteCrowdReportTransport({
      fetch,
      ingestUrl: 'https://example.invalid/internal/api/crowd-reports',
      ingestToken: 'synthetic-secret',
      now: () => NOW,
      maximumResponseBytes: 10,
    });

    await expect(bounded.deliver(request)).rejects.toEqual(
      new SiteDeliveryError('response_too_large', true, 202),
    );
  });

  it('ignores an unusable Retry-After value without exposing it', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(null, {
          status: 429,
          headers: { 'retry-after': '9007199254740000' },
        }),
    );

    await expect(transport(fetch).deliver(request)).rejects.toEqual(
      new SiteDeliveryError('rate_limited', true, 429),
    );
  });
});
