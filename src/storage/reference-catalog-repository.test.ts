import { applyD1Migrations, env } from 'cloudflare:test';
import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import { beforeEach, describe, expect, it } from 'vitest';

import { syntheticReferenceCatalog } from '../../test/fixtures/reference-catalog.js';
import { ReferenceCatalogRepository } from './reference-catalog-repository.js';
import { StorageInvariantError } from './reddit-repository.js';

const testEnv = env as typeof env & { TEST_MIGRATIONS: D1Migration[] };

describe('ReferenceCatalogRepository', () => {
  beforeEach(async () => {
    await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
    await testEnv.DB.prepare('DELETE FROM site_reference_catalog_cache').run();
  });

  it('stores and replaces one validated catalog', async () => {
    const repository = new ReferenceCatalogRepository(testEnv.DB);
    await expect(repository.get()).resolves.toBeNull();
    await expect(
      repository.store(
        syntheticReferenceCatalog,
        '2026-07-19T01:00:00.000Z',
        '2026-07-19T01:05:00.000Z',
      ),
    ).resolves.toEqual({
      catalog: syntheticReferenceCatalog,
      fetchedAt: '2026-07-19T01:00:00.000Z',
      expiresAt: '2026-07-19T01:05:00.000Z',
    });
    expect(
      await testEnv.DB.prepare(
        'SELECT COUNT(*) AS count FROM site_reference_catalog_cache',
      ).first('count'),
    ).toBe(1);
  });

  it('rejects an inconsistent stored row', async () => {
    const repository = new ReferenceCatalogRepository(testEnv.DB);
    await repository.store(
      syntheticReferenceCatalog,
      '2026-07-19T01:00:00.000Z',
      '2026-07-19T01:05:00.000Z',
    );
    await testEnv.DB.prepare(
      `UPDATE site_reference_catalog_cache SET dataset_version = 'changed'`,
    ).run();

    await expect(repository.get()).rejects.toThrowError(
      new StorageInvariantError('corrupt_reference_catalog_row'),
    );
  });
});
