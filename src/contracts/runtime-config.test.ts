import { describe, expect, it } from 'vitest';

import { parseRuntimeConfig } from './runtime-config.js';
import { BoundaryValidationError } from './validation.js';

const validEnv = {
  REDDIT_TRANSPORT_MODE: 'public-shadow',
  REDDIT_USER_AGENT_CONTACT: 'ops@example.invalid',
  REDDIT_SUBREDDITS: 'singapore,askSingapore',
  REDDIT_DISCOVERY_QUERY: 'synthetic rail condition',
  MRTDOWN_SITE_INGEST_URL: 'https://example.invalid/internal/api/crowd-reports',
  MRTDOWN_SITE_INGEST_TOKEN: 'synthetic-site-token',
};

describe('runtime config boundary', () => {
  it('parses explicit public shadow configuration', () => {
    expect(parseRuntimeConfig(validEnv)).toEqual({
      reddit: {
        transportMode: 'public-shadow',
        userAgentContact: 'ops@example.invalid',
      },
      discovery: {
        subreddits: ['singapore', 'askSingapore'],
        query: 'synthetic rail condition',
      },
      site: {
        ingestUrl: 'https://example.invalid/internal/api/crowd-reports',
        ingestToken: 'synthetic-site-token',
      },
    });
  });

  it('requires OAuth credentials only in OAuth mode', () => {
    expect(() =>
      parseRuntimeConfig({
        ...validEnv,
        REDDIT_TRANSPORT_MODE: 'oauth',
      }),
    ).toThrowError(
      new BoundaryValidationError('runtime_config', 'reddit_client_id'),
    );

    expect(
      parseRuntimeConfig({
        ...validEnv,
        REDDIT_TRANSPORT_MODE: 'oauth',
        REDDIT_CLIENT_ID: 'synthetic-client',
        REDDIT_CLIENT_SECRET: 'synthetic-secret',
      }).reddit,
    ).toMatchObject({
      transportMode: 'oauth',
      clientId: 'synthetic-client',
      clientSecret: 'synthetic-secret',
    });
  });

  it('rejects unsafe site URLs without echoing secret input', () => {
    const secretUrl = 'http://secret.invalid/private';
    expect(() =>
      parseRuntimeConfig({
        ...validEnv,
        MRTDOWN_SITE_INGEST_URL: secretUrl,
      }),
    ).toThrowError(
      new BoundaryValidationError('runtime_config', 'site_ingest_url'),
    );

    try {
      parseRuntimeConfig({
        ...validEnv,
        MRTDOWN_SITE_INGEST_URL: secretUrl,
      });
    } catch (error) {
      expect(String(error)).not.toContain(secretUrl);
    }
  });
});
