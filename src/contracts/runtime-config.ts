import { fail, parseHttpUrl, parseRecord, parseString } from './validation.js';

const BOUNDARY = 'runtime_config';
const SUBREDDIT_PATTERN = /^[A-Za-z0-9_]{1,21}$/;

interface SharedRedditConfig {
  userAgentContact: string;
}

export type RedditRuntimeConfig =
  | (SharedRedditConfig & {
      transportMode: 'public-shadow';
    })
  | (SharedRedditConfig & {
      transportMode: 'oauth';
      clientId: string;
      clientSecret: string;
    });

export interface RuntimeConfig {
  reddit: RedditRuntimeConfig;
  discovery: {
    subreddits: string[];
    query: string;
  };
  site: {
    ingestUrl: string;
    referenceCatalogUrl: string;
    ingestToken: string;
  };
}

export function parseRuntimeConfig(input: unknown): RuntimeConfig {
  const env = parseRecord(input, BOUNDARY);
  const transportMode = parseTransportMode(env.REDDIT_TRANSPORT_MODE);
  const userAgentContact = parseSingleLineString(
    env.REDDIT_USER_AGENT_CONTACT,
    'reddit_user_agent_contact',
    200,
  );
  const reddit: RedditRuntimeConfig =
    transportMode === 'oauth'
      ? {
          transportMode: 'oauth',
          userAgentContact,
          clientId: parseString(
            env.REDDIT_CLIENT_ID,
            BOUNDARY,
            'reddit_client_id',
            { maximumLength: 256 },
          ),
          clientSecret: parseString(
            env.REDDIT_CLIENT_SECRET,
            BOUNDARY,
            'reddit_client_secret',
            { maximumLength: 512 },
          ),
        }
      : { transportMode: 'public-shadow', userAgentContact };

  const ingestUrl = parseHttpUrl(
    env.MRTDOWN_SITE_INGEST_URL,
    BOUNDARY,
    'site_ingest_url',
  );
  if (new URL(ingestUrl).protocol !== 'https:') {
    fail(BOUNDARY, 'site_ingest_url');
  }
  const referenceCatalogUrl = parseHttpUrl(
    env.MRTDOWN_SITE_REFERENCE_CATALOG_URL,
    BOUNDARY,
    'site_reference_catalog_url',
  );
  if (
    new URL(referenceCatalogUrl).protocol !== 'https:' ||
    new URL(referenceCatalogUrl).origin !== new URL(ingestUrl).origin
  ) {
    fail(BOUNDARY, 'site_reference_catalog_url');
  }

  return {
    reddit,
    discovery: {
      subreddits: parseSubreddits(env.REDDIT_SUBREDDITS),
      query: parseSingleLineString(
        env.REDDIT_DISCOVERY_QUERY,
        'reddit_discovery_query',
        500,
      ),
    },
    site: {
      ingestUrl,
      referenceCatalogUrl,
      ingestToken: parseSiteToken(env.MRTDOWN_SITE_INGEST_TOKEN),
    },
  };
}

function parseSiteToken(input: unknown): string {
  const token = parseSingleLineString(input, 'site_ingest_token', 4_096);
  if (token.length < 16) fail(BOUNDARY, 'site_ingest_token');
  return token;
}

function parseTransportMode(input: unknown): 'oauth' | 'public-shadow' {
  if (input !== 'oauth' && input !== 'public-shadow') {
    fail(BOUNDARY, 'reddit_transport_mode');
  }
  return input;
}

function parseSubreddits(input: unknown): string[] {
  const value = parseSingleLineString(input, 'reddit_subreddits', 256);
  const subreddits = value.split(',').map((part) => part.trim());
  if (
    subreddits.length === 0 ||
    subreddits.some((subreddit) => !SUBREDDIT_PATTERN.test(subreddit))
  ) {
    fail(BOUNDARY, 'reddit_subreddits');
  }
  const unique = new Set(
    subreddits.map((subreddit) => subreddit.toLowerCase()),
  );
  if (unique.size !== subreddits.length) fail(BOUNDARY, 'reddit_subreddits');
  return subreddits;
}

function parseSingleLineString(
  input: unknown,
  code: string,
  maximumLength: number,
): string {
  const value = parseString(input, BOUNDARY, code, { maximumLength });
  if (/[\r\n]/.test(value)) fail(BOUNDARY, code);
  return value;
}
