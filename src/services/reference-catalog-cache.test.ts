import { describe, expect, it, vi } from 'vitest';

import { syntheticReferenceCatalog } from '../../test/fixtures/reference-catalog.js';
import {
  ReferenceCatalogTransportError,
  type ReferenceCatalogFetchResult,
} from './site-reference-catalog-transport.js';
import { ReferenceCatalogCache } from './reference-catalog-cache.js';

const NOW = new Date('2026-07-19T01:00:00.000Z');

describe('reference catalog cache', () => {
  it('returns a fresh durable catalog without a network request', async () => {
    const repository = {
      get: vi.fn().mockResolvedValue({
        catalog: syntheticReferenceCatalog,
        fetchedAt: '2026-07-19T00:59:00.000Z',
        expiresAt: '2026-07-19T01:04:00.000Z',
      }),
      store: vi.fn(),
    };
    const transport = { fetchCatalog: vi.fn() };

    await expect(
      new ReferenceCatalogCache(repository, transport, () => NOW).getCatalog(),
    ).resolves.toEqual(syntheticReferenceCatalog);
    expect(transport.fetchCatalog).not.toHaveBeenCalled();
  });

  it('refreshes an expired catalog and stores the response-directed expiry', async () => {
    const stored = {
      catalog: syntheticReferenceCatalog,
      fetchedAt: NOW.toISOString(),
      expiresAt: '2026-07-19T01:05:00.000Z',
    };
    const repository = {
      get: vi.fn().mockResolvedValue(null),
      store: vi.fn().mockResolvedValue(stored),
    };
    const transport = {
      fetchCatalog: vi
        .fn<() => Promise<ReferenceCatalogFetchResult>>()
        .mockResolvedValue({
          catalog: syntheticReferenceCatalog,
          maxAgeSeconds: 300,
        }),
    };

    await expect(
      new ReferenceCatalogCache(repository, transport, () => NOW).getCatalog(),
    ).resolves.toEqual(syntheticReferenceCatalog);
    expect(repository.store).toHaveBeenCalledWith(
      syntheticReferenceCatalog,
      NOW.toISOString(),
      '2026-07-19T01:05:00.000Z',
    );
  });

  it('uses a recently stale catalog only for retryable fetch failures', async () => {
    const cached = {
      catalog: syntheticReferenceCatalog,
      fetchedAt: '2026-07-19T00:00:00.000Z',
      expiresAt: '2026-07-19T00:05:00.000Z',
    };
    const repository = {
      get: vi.fn().mockResolvedValue(cached),
      store: vi.fn(),
    };
    const retryableTransport = {
      fetchCatalog: vi
        .fn()
        .mockRejectedValue(
          new ReferenceCatalogTransportError('server', true, 503),
        ),
    };
    await expect(
      new ReferenceCatalogCache(
        repository,
        retryableTransport,
        () => NOW,
      ).getCatalog(),
    ).resolves.toEqual(syntheticReferenceCatalog);

    const terminalTransport = {
      fetchCatalog: vi
        .fn()
        .mockRejectedValue(
          new ReferenceCatalogTransportError('authentication', false, 401),
        ),
    };
    await expect(
      new ReferenceCatalogCache(
        repository,
        terminalTransport,
        () => NOW,
      ).getCatalog(),
    ).rejects.toMatchObject({ category: 'authentication' });
  });
});
