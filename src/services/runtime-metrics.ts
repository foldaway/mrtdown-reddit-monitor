import type { RedditAccessState } from '../storage/reddit-access-repository.js';
import type { OperationalMetricsSnapshot } from '../storage/reddit-repository.js';

interface OperationalMetricsRepository {
  getOperationalMetrics(): Promise<OperationalMetricsSnapshot>;
}

interface RedditAccessStateRepository {
  getState(): Promise<RedditAccessState | null>;
}

export interface RuntimeMetrics {
  discoveryFreshnessSeconds: number | null;
  activeWorkflowCount: number;
  sourceEvaluationStatusCounts: OperationalMetricsSnapshot['sourceEvaluationStatusCounts'];
  pendingDeliveryCount: number;
  oldestPendingDeliveryAgeSeconds: number | null;
  redditAccess: {
    state: 'unobserved' | 'ready' | 'backoff' | 'disabled';
    rateLimitRemaining: number | null;
  };
}

/**
 * Produces a log-safe metrics snapshot from durable state. Times are expressed
 * as ages so logs do not need source or transport timestamps to be useful.
 */
export async function collectRuntimeMetrics(options: {
  repository: OperationalMetricsRepository;
  accessRepository: RedditAccessStateRepository;
  now: () => Date;
}): Promise<RuntimeMetrics> {
  const now = readCurrentTime(options.now);
  const [snapshot, accessState] = await Promise.all([
    options.repository.getOperationalMetrics(),
    options.accessRepository.getState(),
  ]);
  return {
    discoveryFreshnessSeconds: ageInSeconds(snapshot.latestDiscoveryAt, now),
    activeWorkflowCount: snapshot.activeWorkflowCount,
    sourceEvaluationStatusCounts: snapshot.sourceEvaluationStatusCounts,
    pendingDeliveryCount: snapshot.pendingDeliveryCount,
    oldestPendingDeliveryAgeSeconds: ageInSeconds(
      snapshot.oldestPendingDeliveryAt,
      now,
    ),
    redditAccess: {
      state: getAccessState(accessState, now),
      rateLimitRemaining: accessState?.rateLimitRemaining ?? null,
    },
  };
}

function readCurrentTime(now: () => Date): number {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) {
    throw new TypeError('Invalid current time');
  }
  return value.valueOf();
}

function ageInSeconds(timestamp: string | null, now: number): number | null {
  if (timestamp === null) return null;
  return Math.max(0, Math.floor((now - Date.parse(timestamp)) / 1_000));
}

function getAccessState(
  state: RedditAccessState | null,
  now: number,
): RuntimeMetrics['redditAccess']['state'] {
  if (state === null) return 'unobserved';
  if (state.disabledReason !== null) return 'disabled';
  if (state.blockedUntil !== null && Date.parse(state.blockedUntil) > now) {
    return 'backoff';
  }
  return 'ready';
}
