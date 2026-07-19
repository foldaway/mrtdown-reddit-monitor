import {
  parseReferenceCatalog,
  type ReferenceCatalog,
} from '../contracts/reference-catalog.js';
import { StorageInvariantError } from './reddit-repository.js';

export interface StoredReferenceCatalog {
  catalog: ReferenceCatalog;
  fetchedAt: string;
  expiresAt: string;
}

export class ReferenceCatalogRepository {
  constructor(private readonly database: D1Database) {}

  async get(): Promise<StoredReferenceCatalog | null> {
    let row: Record<string, unknown> | null;
    try {
      row = await this.database
        .prepare(
          `SELECT schema_version, dataset_version, reference_date,
                  catalog_json, fetched_at, expires_at
           FROM site_reference_catalog_cache WHERE singleton_id = 1`,
        )
        .first<Record<string, unknown>>();
    } catch {
      throw new StorageInvariantError('reference_catalog_read_failed');
    }
    return row === null ? null : parseRow(row);
  }

  async store(
    catalogInput: ReferenceCatalog,
    fetchedAt: string,
    expiresAt: string,
  ): Promise<StoredReferenceCatalog> {
    const catalog = parseReferenceCatalog(catalogInput);
    const normalizedFetchedAt = normalizeTimestamp(fetchedAt, 'fetched_at');
    const normalizedExpiresAt = normalizeTimestamp(expiresAt, 'expires_at');
    if (normalizedExpiresAt <= normalizedFetchedAt) {
      throw new StorageInvariantError('reference_catalog_expiry');
    }
    try {
      await this.database
        .prepare(
          `INSERT INTO site_reference_catalog_cache (
             singleton_id, schema_version, dataset_version, reference_date,
             catalog_json, fetched_at, expires_at
           ) VALUES (1, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(singleton_id) DO UPDATE SET
             schema_version = excluded.schema_version,
             dataset_version = excluded.dataset_version,
             reference_date = excluded.reference_date,
             catalog_json = excluded.catalog_json,
             fetched_at = excluded.fetched_at,
             expires_at = excluded.expires_at`,
        )
        .bind(
          catalog.schemaVersion,
          catalog.datasetVersion,
          catalog.referenceDate,
          JSON.stringify(catalog),
          normalizedFetchedAt,
          normalizedExpiresAt,
        )
        .run();
    } catch {
      throw new StorageInvariantError('reference_catalog_write_failed');
    }
    const stored = await this.get();
    if (stored === null) {
      throw new StorageInvariantError('reference_catalog_write_failed');
    }
    return stored;
  }
}

function parseRow(row: Record<string, unknown>): StoredReferenceCatalog {
  try {
    if (row.schema_version !== 1 || typeof row.catalog_json !== 'string') {
      throw new Error('invalid row');
    }
    const catalog = parseReferenceCatalog(JSON.parse(row.catalog_json));
    if (
      row.dataset_version !== catalog.datasetVersion ||
      row.reference_date !== catalog.referenceDate
    ) {
      throw new Error('inconsistent row');
    }
    return {
      catalog,
      fetchedAt: normalizeTimestamp(row.fetched_at, 'fetched_at'),
      expiresAt: normalizeTimestamp(row.expires_at, 'expires_at'),
    };
  } catch {
    throw new StorageInvariantError('corrupt_reference_catalog_row');
  }
}

function normalizeTimestamp(value: unknown, code: string): string {
  if (
    typeof value !== 'string' ||
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new StorageInvariantError(code);
  }
  return new Date(value).toISOString();
}
