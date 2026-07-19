import { describe, expect, it, vi } from 'vitest';

import { syntheticReferenceCatalog } from '../../test/fixtures/reference-catalog.js';
import {
  ReferenceCatalogTransportError,
  SiteReferenceCatalogTransport,
} from './site-reference-catalog-transport.js';

function transport(fetch: typeof globalThis.fetch) {
  return new SiteReferenceCatalogTransport({
    fetch,
    url: 'https://example.invalid/internal/api/reference-catalog/v1',
    token: 'synthetic-site-token',
  });
}

describe('site reference catalog transport', () => {
  it('fetches an authenticated v1 catalog and honors bounded cache age', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const request = new Request(input);
      expect(request.method).toBe('GET');
      expect(request.redirect).toBe('manual');
      expect(request.headers.get('authorization')).toBe(
        'Bearer synthetic-site-token',
      );
      return Response.json(
        { success: true, data: syntheticReferenceCatalog },
        {
          headers: { 'cache-control': 'private, max-age=300' },
        },
      );
    });

    await expect(transport(fetch).fetchCatalog()).resolves.toEqual({
      catalog: syntheticReferenceCatalog,
      maxAgeSeconds: 300,
    });
  });

  it.each([
    [401, 'authentication', false],
    [503, 'server', true],
    [404, 'unexpected_status', false],
  ] as const)('normalizes HTTP %i without reading its body', async (status, category, retryable) => {
    const fetch = vi.fn(async () => new Response('untrusted body', { status }));
    await expect(transport(fetch).fetchCatalog()).rejects.toMatchObject({
      category,
      retryable,
      status,
    });
  });

  it('normalizes malformed and oversized successful responses', async () => {
    const malformed = transport(
      vi.fn(
        async () =>
          new Response('{invalid', {
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    await expect(malformed.fetchCatalog()).rejects.toEqual(
      new ReferenceCatalogTransportError('invalid_response', false, 200),
    );

    const oversized = new SiteReferenceCatalogTransport({
      fetch: vi.fn(
        async () =>
          new Response('{}', {
            headers: {
              'content-length': '100',
              'content-type': 'application/json',
            },
          }),
      ),
      url: 'https://example.invalid/internal/api/reference-catalog/v1',
      token: 'synthetic-site-token',
      maximumResponseBytes: 10,
    });
    await expect(oversized.fetchCatalog()).rejects.toEqual(
      new ReferenceCatalogTransportError('response_too_large', false, 200),
    );
  });
});
