import type { ReferenceCatalog } from '../contracts/reference-catalog.js';
import type { StoredReferenceCatalog } from '../storage/reference-catalog-repository.js';
import {
  ReferenceCatalogTransportError,
  type ReferenceCatalogFetchResult,
} from './site-reference-catalog-transport.js';

const MAXIMUM_STALE_MILLISECONDS = 24 * 60 * 60 * 1_000;

interface ReferenceCatalogCacheRepository {
  get(): Promise<StoredReferenceCatalog | null>;
  store(
    catalog: ReferenceCatalog,
    fetchedAt: string,
    expiresAt: string,
  ): Promise<StoredReferenceCatalog>;
}

interface ReferenceCatalogTransport {
  fetchCatalog(): Promise<ReferenceCatalogFetchResult>;
}

export class ReferenceCatalogCache {
  constructor(
    private readonly repository: ReferenceCatalogCacheRepository,
    private readonly transport: ReferenceCatalogTransport,
    private readonly now: () => Date,
  ) {}

  async getCatalog(): Promise<ReferenceCatalog> {
    const now = readCurrentTime(this.now);
    const cached = await this.repository.get();
    if (cached !== null && Date.parse(cached.expiresAt) > now) {
      return cached.catalog;
    }

    try {
      const fetched = await this.transport.fetchCatalog();
      const fetchedAt = new Date(now).toISOString();
      const expiresAt = new Date(
        now + fetched.maxAgeSeconds * 1_000,
      ).toISOString();
      return (
        await this.repository.store(fetched.catalog, fetchedAt, expiresAt)
      ).catalog;
    } catch (error) {
      if (
        error instanceof ReferenceCatalogTransportError &&
        error.retryable &&
        cached !== null &&
        now - Date.parse(cached.fetchedAt) <= MAXIMUM_STALE_MILLISECONDS
      ) {
        return cached.catalog;
      }
      throw error;
    }
  }
}

function readCurrentTime(now: () => Date): number {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) {
    throw new TypeError('Invalid current time');
  }
  return value.valueOf();
}
