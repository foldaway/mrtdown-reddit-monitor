import { parseRuntimeConfig } from '../contracts/runtime-config.js';
import {
  BackoffAwarePublicShadowRedditTransport,
  RedditAccessPausedError,
} from '../services/reddit-access-policy.js';
import { ReferenceCatalogCache } from '../services/reference-catalog-cache.js';
import {
  PublicShadowRedditDiscoveryTransport,
  PublicShadowRedditTransport,
  RedditTransportError,
} from '../services/public-shadow-reddit-transport.js';
import {
  type ScheduledRedditDiscoveryResult,
  runScheduledRedditDiscovery,
} from '../services/reddit-discovery.js';
import {
  evaluatePendingSources,
  type SourceEvaluationResult,
} from '../services/source-evaluation.js';
import {
  deliverPendingSources,
  type SourceDeliveryResult,
} from '../services/source-delivery.js';
import { SiteCrowdReportTransport } from '../services/site-crowd-report-transport.js';
import {
  startSelectedThreadWorkflows,
  type ThreadWorkflowStartResult,
} from '../services/thread-workflow-starter.js';
import {
  ReferenceCatalogTransportError,
  SiteReferenceCatalogTransport,
} from '../services/site-reference-catalog-transport.js';
import {
  SemanticParserError,
  WorkersAiSemanticParser,
} from '../services/workers-ai-semantic-parser.js';
import { collectRuntimeMetrics } from '../services/runtime-metrics.js';
import { RedditAccessRepository } from '../storage/reddit-access-repository.js';
import { RedditDiscoveryCandidateRepository } from '../storage/reddit-discovery-candidate-repository.js';
import { RedditDiscoveryScheduleRepository } from '../storage/reddit-discovery-schedule-repository.js';
import { ReferenceCatalogRepository } from '../storage/reference-catalog-repository.js';
import { RedditRepository } from '../storage/reddit-repository.js';

export type ScheduledDiscoveryOutcome =
  | {
      outcome: 'completed';
      discovery: ScheduledRedditDiscoveryResult;
      evaluation: SourceEvaluationResult;
      delivery: SourceDeliveryResult;
      workflowStart: ThreadWorkflowStartResult;
    }
  | {
      outcome: 'paused';
      reason: RedditAccessPausedError['reason'];
      resumeAt: string | null;
      delivery: SourceDeliveryResult;
      workflowStart: ThreadWorkflowStartResult;
    }
  | {
      outcome: 'transport_error';
      category: RedditTransportError['category'];
      resumeAt: string | null;
      disabled: boolean;
      delivery: SourceDeliveryResult;
      workflowStart: ThreadWorkflowStartResult;
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
  const candidateQueue = new RedditDiscoveryCandidateRepository(env.DB);
  const schedule = new RedditDiscoveryScheduleRepository(env.DB);
  const repository = new RedditRepository(env.DB);
  const guardedTransport = new BackoffAwarePublicShadowRedditTransport(
    discoveryTransport,
    conversationTransport,
    accessRepository,
    dependencies.now,
  );

  try {
    const discovery = await runScheduledRedditDiscovery({
      ...config.discovery,
      discoveryTransport: guardedTransport,
      conversationTransport: guardedTransport,
      candidateQueue,
      schedule,
      repository,
      now: dependencies.now,
    });
    const semanticParser = new WorkersAiSemanticParser(
      {
        run: (model, input) => env.AI.run(model, input),
      },
      createReferenceCatalogCache(env, config.site, dependencies),
    );
    const evaluation = await evaluatePendingSources({
      repository,
      semanticParser,
      now: dependencies.now,
    });
    const { delivery, workflowStart } = await runDeliveryAndStart(
      repository,
      env,
      config.site,
      dependencies,
    );
    await logRuntimeEvent(
      dependencies,
      repository,
      accessRepository,
      'reddit_discovery_completed',
      { ...discovery, ...evaluation, ...delivery, ...workflowStart },
    );
    return {
      outcome: 'completed',
      discovery,
      evaluation,
      delivery,
      workflowStart,
    };
  } catch (error) {
    if (error instanceof RedditAccessPausedError) {
      const { delivery, workflowStart } = await runDeliveryAndStart(
        repository,
        env,
        config.site,
        dependencies,
      );
      const outcome = {
        outcome: 'paused' as const,
        reason: error.reason,
        resumeAt: error.resumeAt,
        delivery,
        workflowStart,
      };
      await logRuntimeEvent(
        dependencies,
        repository,
        accessRepository,
        'reddit_discovery_paused',
        outcome,
      );
      return outcome;
    }
    if (error instanceof RedditTransportError) {
      const state = await accessRepository.getState();
      const { delivery, workflowStart } = await runDeliveryAndStart(
        repository,
        env,
        config.site,
        dependencies,
      );
      const outcome = {
        outcome: 'transport_error' as const,
        category: error.category,
        resumeAt: state?.blockedUntil ?? null,
        disabled: state?.disabledReason != null,
        delivery,
        workflowStart,
      };
      await logRuntimeEvent(
        dependencies,
        repository,
        accessRepository,
        'reddit_discovery_transport_error',
        outcome,
      );
      return outcome;
    }
    if (error instanceof SemanticParserError) {
      await runDeliveryAndStart(repository, env, config.site, dependencies);
      await logRuntimeEvent(
        dependencies,
        repository,
        accessRepository,
        'reddit_semantic_parser_error',
        { category: error.category },
      );
    }
    if (error instanceof ReferenceCatalogTransportError) {
      await runDeliveryAndStart(repository, env, config.site, dependencies);
      await logRuntimeEvent(
        dependencies,
        repository,
        accessRepository,
        'site_reference_catalog_error',
        { category: error.category },
      );
    }
    throw error;
  }
}

async function logRuntimeEvent(
  dependencies: ScheduledDiscoveryDependencies,
  repository: RedditRepository,
  accessRepository: RedditAccessRepository,
  event: string,
  details: object,
): Promise<void> {
  dependencies.log({
    event,
    ...details,
    metrics: await collectRuntimeMetrics({
      repository,
      accessRepository,
      now: dependencies.now,
    }),
  });
}

function createReferenceCatalogCache(
  env: Env,
  site: {
    referenceCatalogUrl: string;
    ingestToken: string;
  },
  dependencies: ScheduledDiscoveryDependencies,
): ReferenceCatalogCache {
  return new ReferenceCatalogCache(
    new ReferenceCatalogRepository(env.DB),
    new SiteReferenceCatalogTransport({
      fetch: dependencies.fetch,
      url: site.referenceCatalogUrl,
      token: site.ingestToken,
    }),
    dependencies.now,
  );
}

async function runDeliveryAndStart(
  repository: RedditRepository,
  env: Env,
  site: { ingestUrl: string; ingestToken: string },
  dependencies: ScheduledDiscoveryDependencies,
): Promise<{
  delivery: SourceDeliveryResult;
  workflowStart: ThreadWorkflowStartResult;
}> {
  const delivery = await deliverPendingSources({
    repository,
    transport: new SiteCrowdReportTransport({
      fetch: dependencies.fetch,
      ingestUrl: site.ingestUrl,
      ingestToken: site.ingestToken,
      now: dependencies.now,
    }),
    now: dependencies.now,
  });
  const workflowStart = await startSelectedThreadWorkflows({
    repository,
    workflow: env.REDDIT_THREAD_WORKFLOW,
    now: dependencies.now,
  });
  return { delivery, workflowStart };
}
