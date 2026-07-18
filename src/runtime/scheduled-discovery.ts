import { parseRuntimeConfig } from '../contracts/runtime-config.js';
import {
  BackoffAwarePublicShadowRedditTransport,
  RedditAccessPausedError,
} from '../services/reddit-access-policy.js';
import {
  PublicShadowRedditDiscoveryTransport,
  PublicShadowRedditTransport,
  RedditTransportError,
} from '../services/public-shadow-reddit-transport.js';
import {
  type RedditDiscoveryResult,
  runRedditDiscovery,
} from '../services/reddit-discovery.js';
import { RedditAccessRepository } from '../storage/reddit-access-repository.js';
import { RedditRepository } from '../storage/reddit-repository.js';

export type ScheduledDiscoveryOutcome =
  | { outcome: 'completed'; discovery: RedditDiscoveryResult }
  | {
      outcome: 'paused';
      reason: RedditAccessPausedError['reason'];
      resumeAt: string | null;
    }
  | {
      outcome: 'transport_error';
      category: RedditTransportError['category'];
      resumeAt: string | null;
      disabled: boolean;
    };

interface ScheduledDiscoveryDependencies {
  fetch: typeof fetch;
  now: () => Date;
  log: (record: Record<string, unknown>) => void;
}

const defaultDependencies: ScheduledDiscoveryDependencies = {
  fetch,
  now: () => new Date(),
  log: (record) => console.log(JSON.stringify(record)),
};

export class ScheduledDiscoveryRuntimeError extends Error {
  constructor(readonly category: 'oauth_not_implemented') {
    super(`Scheduled discovery runtime failed: ${category}`);
    this.name = 'ScheduledDiscoveryRuntimeError';
  }
}

export async function runScheduledDiscovery(
  env: Env,
  dependencies: ScheduledDiscoveryDependencies = defaultDependencies,
): Promise<ScheduledDiscoveryOutcome> {
  const config = parseRuntimeConfig(env);
  if (config.reddit.transportMode !== 'public-shadow') {
    throw new ScheduledDiscoveryRuntimeError('oauth_not_implemented');
  }

  const userAgent = `mrtdown-reddit-monitor/1.0 (contact: ${config.reddit.userAgentContact})`;
  const discoveryTransport = new PublicShadowRedditDiscoveryTransport({
    fetch: dependencies.fetch,
    userAgent,
    now: dependencies.now,
  });
  const conversationTransport = new PublicShadowRedditTransport({
    fetch: dependencies.fetch,
    userAgent,
    now: dependencies.now,
  });
  const accessRepository = new RedditAccessRepository(env.DB);
  const guardedTransport = new BackoffAwarePublicShadowRedditTransport(
    discoveryTransport,
    conversationTransport,
    accessRepository,
    dependencies.now,
  );

  try {
    const discovery = await runRedditDiscovery({
      ...config.discovery,
      discoveryTransport: guardedTransport,
      conversationTransport: guardedTransport,
      repository: new RedditRepository(env.DB),
      now: dependencies.now,
    });
    dependencies.log({
      event: 'reddit_discovery_completed',
      ...discovery,
    });
    return { outcome: 'completed', discovery };
  } catch (error) {
    if (error instanceof RedditAccessPausedError) {
      const outcome = {
        outcome: 'paused' as const,
        reason: error.reason,
        resumeAt: error.resumeAt,
      };
      dependencies.log({ event: 'reddit_discovery_paused', ...outcome });
      return outcome;
    }
    if (error instanceof RedditTransportError) {
      const state = await accessRepository.getState();
      const outcome = {
        outcome: 'transport_error' as const,
        category: error.category,
        resumeAt: state?.blockedUntil ?? null,
        disabled: state?.disabledReason != null,
      };
      dependencies.log({
        event: 'reddit_discovery_transport_error',
        ...outcome,
      });
      return outcome;
    }
    throw error;
  }
}
