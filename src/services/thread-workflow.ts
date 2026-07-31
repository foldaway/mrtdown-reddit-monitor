import type { ParserDecision } from '../contracts/crowd-report.js';
import type { RedditSourceObject } from '../contracts/reddit-source.js';
import type {
  CrowdReportDeliveryRequest,
  SiteAcceptedResponse,
} from '../contracts/site.js';
import {
  storeRedditConversationSnapshot,
  type RedditConversationSnapshotResult,
} from './reddit-conversation-snapshot.js';
import {
  type PublicConversationFetchResult,
  RedditTransportError,
} from './public-shadow-reddit-transport.js';
import { RedditAccessPausedError } from './reddit-access-policy.js';
import {
  deliverPendingSources,
  type SourceDeliveryResult,
} from './source-delivery.js';
import {
  evaluatePendingSources,
  type SourceEvaluationResult,
} from './source-evaluation.js';
import type {
  PendingDeliveryRecord,
  SourceVersionKey,
  StoredSourceVersion,
} from '../storage/reddit-repository.js';

export const THREAD_WORKFLOW_POLL_OFFSETS_MINUTES = [
  10, 25, 40, 55, 180, 360, 1440,
] as const;

interface ThreadWorkflowRepository {
  storeSourceVersion(
    source: RedditSourceObject,
    contentVersion: string,
    seenAt: string,
  ): Promise<{ inserted: boolean }>;
  listPendingEvaluations(
    limit?: number,
    threadExternalId?: string,
  ): Promise<StoredSourceVersion[]>;
  recordEvaluation(
    key: SourceVersionKey,
    decision: unknown,
    evaluatedAt: string,
    externalReportId?: string,
  ): Promise<StoredSourceVersion>;
  listReadyDeliveries(
    readyAt: string,
    limit?: number,
    threadExternalId?: string,
  ): Promise<PendingDeliveryRecord[]>;
  recordDeliveryAcknowledgement(
    key: SourceVersionKey,
    response: SiteAcceptedResponse,
    acknowledgedAt: string,
  ): Promise<unknown>;
  recordDeliveryFailure(
    key: SourceVersionKey,
    failure: {
      category: import('../contracts/site.js').SiteDeliveryErrorCategory;
      retryAt: string | null;
      terminal: boolean;
    },
    attemptedAt: string,
  ): Promise<unknown>;
}

interface ConversationTransport {
  fetchConversation(
    threadExternalId: string,
  ): Promise<PublicConversationFetchResult>;
}

interface SemanticParser {
  parse(source: RedditSourceObject): Promise<ParserDecision>;
}

interface DeliveryTransport {
  deliver(request: CrowdReportDeliveryRequest): Promise<SiteAcceptedResponse>;
}

export type ThreadWorkflowCheckResult =
  | {
      outcome: 'completed';
      snapshot: RedditConversationSnapshotResult | null;
      evaluation: SourceEvaluationResult;
      delivery: SourceDeliveryResult;
    }
  | {
      outcome: 'paused';
      reason: RedditAccessPausedError['reason'];
      resumeAt: string | null;
      delivery: SourceDeliveryResult;
    }
  | {
      outcome: 'transport_error';
      category: RedditTransportError['category'];
      status: number | null;
      delivery: SourceDeliveryResult;
    };

export async function runThreadWorkflowCheck(options: {
  threadExternalId: string;
  repository: ThreadWorkflowRepository;
  conversationTransport: ConversationTransport;
  semanticParser: SemanticParser;
  deliveryTransport: DeliveryTransport;
  now: () => Date;
}): Promise<ThreadWorkflowCheckResult> {
  const seenAt = currentTimestamp(options.now);
  try {
    const fetched = await options.conversationTransport.fetchConversation(
      options.threadExternalId,
    );
    const snapshot =
      fetched.kind === 'conversation'
        ? await storeRedditConversationSnapshot(
            fetched.conversation,
            options.repository,
            seenAt,
          )
        : null;
    const evaluation = await evaluatePendingSources({
      repository: scopedEvaluationRepository(
        options.repository,
        options.threadExternalId,
      ),
      semanticParser: options.semanticParser,
      now: options.now,
    });
    const delivery = await deliverPendingSources({
      repository: scopedDeliveryRepository(
        options.repository,
        options.threadExternalId,
      ),
      transport: options.deliveryTransport,
      now: options.now,
    });
    return { outcome: 'completed', snapshot, evaluation, delivery };
  } catch (error) {
    const delivery = await deliverPendingSources({
      repository: scopedDeliveryRepository(
        options.repository,
        options.threadExternalId,
      ),
      transport: options.deliveryTransport,
      now: options.now,
    });
    if (error instanceof RedditAccessPausedError) {
      return {
        outcome: 'paused',
        reason: error.reason,
        resumeAt: error.resumeAt,
        delivery,
      };
    }
    if (error instanceof RedditTransportError) {
      return {
        outcome: 'transport_error',
        category: error.category,
        status: error.metadata?.status ?? null,
        delivery,
      };
    }
    throw error;
  }
}

function scopedEvaluationRepository(
  repository: ThreadWorkflowRepository,
  threadExternalId: string,
) {
  return {
    listPendingEvaluations: (limit?: number) =>
      repository.listPendingEvaluations(limit, threadExternalId),
    recordEvaluation: repository.recordEvaluation.bind(repository),
  };
}

function scopedDeliveryRepository(
  repository: ThreadWorkflowRepository,
  threadExternalId: string,
) {
  return {
    listReadyDeliveries: (readyAt: string, limit?: number) =>
      repository.listReadyDeliveries(readyAt, limit, threadExternalId),
    recordDeliveryAcknowledgement:
      repository.recordDeliveryAcknowledgement.bind(repository),
    recordDeliveryFailure: repository.recordDeliveryFailure.bind(repository),
  };
}

function currentTimestamp(now: () => Date): string {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) {
    throw new TypeError('Invalid current time');
  }
  return value.toISOString();
}
