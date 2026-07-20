import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from 'cloudflare:workers';

import { parseRuntimeConfig } from '../contracts/runtime-config.js';
import { BackoffAwarePublicShadowRedditTransport } from '../services/reddit-access-policy.js';
import { ReferenceCatalogCache } from '../services/reference-catalog-cache.js';
import {
  PublicShadowRedditDiscoveryTransport,
  PublicShadowRedditTransport,
} from '../services/public-shadow-reddit-transport.js';
import {
  ReferenceCatalogTransportError,
  SiteReferenceCatalogTransport,
} from '../services/site-reference-catalog-transport.js';
import { SiteCrowdReportTransport } from '../services/site-crowd-report-transport.js';
import {
  THREAD_WORKFLOW_POLL_OFFSETS_MINUTES,
  runThreadWorkflowCheck,
} from '../services/thread-workflow.js';
import type { ThreadWorkflowParameters } from '../services/thread-workflow-starter.js';
import {
  SemanticParserError,
  WorkersAiSemanticParser,
} from '../services/workers-ai-semantic-parser.js';
import { RedditAccessRepository } from '../storage/reddit-access-repository.js';
import { ReferenceCatalogRepository } from '../storage/reference-catalog-repository.js';
import { RedditRepository } from '../storage/reddit-repository.js';

const THREAD_EXTERNAL_ID_PATTERN = /^t3_[a-z0-9]+$/;

interface ThreadWorkflowDependencies {
  fetch: typeof fetch;
  now: () => Date;
  log: (record: Record<string, unknown>) => void;
}

const defaultDependencies: ThreadWorkflowDependencies = {
  fetch,
  now: () => new Date(),
  log: (record) => console.log(JSON.stringify(record)),
};

export class ThreadWorkflowRuntimeError extends Error {
  constructor(readonly category: 'invalid_payload' | 'oauth_not_implemented') {
    super(`Thread Workflow runtime failed: ${category}`);
    this.name = 'ThreadWorkflowRuntimeError';
  }
}

export class RedditThreadWorkflow extends WorkflowEntrypoint<
  Env,
  ThreadWorkflowParameters
> {
  async run(
    event: Readonly<WorkflowEvent<ThreadWorkflowParameters>>,
    step: WorkflowStep,
  ): Promise<{ checkCount: number }> {
    const parameters = parseThreadWorkflowParameters(event.payload);
    const startedAt = readWorkflowTimestamp(event.timestamp);

    for (const offsetMinutes of THREAD_WORKFLOW_POLL_OFFSETS_MINUTES) {
      await step.sleepUntil(
        `wait until +${offsetMinutes}m`,
        new Date(startedAt + offsetMinutes * 60_000),
      );
      const outcome = await step.do(`check +${offsetMinutes}m`, async () =>
        runThreadWorkflowRuntime(this.env, parameters),
      );
      console.log(
        JSON.stringify({
          event: 'reddit_thread_workflow_check',
          offsetMinutes,
          ...outcome,
        }),
      );
    }

    return { checkCount: THREAD_WORKFLOW_POLL_OFFSETS_MINUTES.length };
  }
}

export async function runThreadWorkflowRuntime(
  env: Env,
  parameters: ThreadWorkflowParameters,
  dependencies: ThreadWorkflowDependencies = defaultDependencies,
) {
  const config = parseRuntimeConfig(env);
  if (config.reddit.transportMode !== 'public-shadow') {
    throw new ThreadWorkflowRuntimeError('oauth_not_implemented');
  }
  const threadExternalId =
    parseThreadWorkflowParameters(parameters).threadExternalId;
  const userAgent = `mrtdown-reddit-monitor/1.0 (contact: ${config.reddit.userAgentContact})`;
  const repository = new RedditRepository(env.DB);
  const conversationTransport = new BackoffAwarePublicShadowRedditTransport(
    new PublicShadowRedditDiscoveryTransport({
      fetch: dependencies.fetch,
      userAgent,
      now: dependencies.now,
    }),
    new PublicShadowRedditTransport({
      fetch: dependencies.fetch,
      userAgent,
      now: dependencies.now,
    }),
    new RedditAccessRepository(env.DB),
    dependencies.now,
  );
  const semanticParser = new WorkersAiSemanticParser(
    { run: (model, input) => env.AI.run(model, input) },
    new ReferenceCatalogCache(
      new ReferenceCatalogRepository(env.DB),
      new SiteReferenceCatalogTransport({
        fetch: dependencies.fetch,
        url: config.site.referenceCatalogUrl,
        token: config.site.ingestToken,
      }),
      dependencies.now,
    ),
  );
  const deliveryTransport = new SiteCrowdReportTransport({
    fetch: dependencies.fetch,
    ingestUrl: config.site.ingestUrl,
    ingestToken: config.site.ingestToken,
    now: dependencies.now,
  });

  try {
    return await runThreadWorkflowCheck({
      threadExternalId,
      repository,
      conversationTransport,
      semanticParser,
      deliveryTransport,
      now: dependencies.now,
    });
  } catch (error) {
    if (error instanceof SemanticParserError) {
      dependencies.log({
        event: 'reddit_thread_workflow_parser_error',
        category: error.category,
      });
    }
    if (error instanceof ReferenceCatalogTransportError) {
      dependencies.log({
        event: 'reddit_thread_workflow_reference_catalog_error',
        category: error.category,
      });
    }
    throw error;
  }
}

function parseThreadWorkflowParameters(
  value: unknown,
): ThreadWorkflowParameters {
  if (
    typeof value !== 'object' ||
    value === null ||
    Object.keys(value).length !== 1 ||
    !('threadExternalId' in value) ||
    typeof value.threadExternalId !== 'string' ||
    !THREAD_EXTERNAL_ID_PATTERN.test(value.threadExternalId)
  ) {
    throw new ThreadWorkflowRuntimeError('invalid_payload');
  }
  return { threadExternalId: value.threadExternalId };
}

function readWorkflowTimestamp(value: unknown): number {
  if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) {
    throw new ThreadWorkflowRuntimeError('invalid_payload');
  }
  return value.valueOf();
}
