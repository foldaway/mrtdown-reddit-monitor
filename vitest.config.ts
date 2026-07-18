import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  cloudflareTest,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const projectDirectory = path.dirname(fileURLToPath(import.meta.url));
const testMigrations = await readD1Migrations(
  path.join(projectDirectory, 'migrations'),
);
const syntheticSiteIngestToken = 'synthetic-test-site-token';
process.env.MRTDOWN_SITE_INGEST_TOKEN = syntheticSiteIngestToken;

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          MRTDOWN_SITE_INGEST_TOKEN: syntheticSiteIngestToken,
          TEST_MIGRATIONS: testMigrations,
        },
      },
    }),
  ],
});
