import type {
  CrowdReportDeliveryRequest,
  SiteDeliveryErrorCategory,
  SiteAcceptedResponse,
} from '../contracts/site.js';
import type {
  PendingDeliveryRecord,
  SourceVersionKey,
} from '../storage/reddit-repository.js';
import { SiteDeliveryError } from './site-crowd-report-transport.js';

interface DeliveryRepository {
  listReadyDeliveries(
    readyAt: string,
    limit?: number,
  ): Promise<PendingDeliveryRecord[]>;
  recordDeliveryAcknowledgement(
    key: SourceVersionKey,
    response: SiteAcceptedResponse,
    acknowledgedAt: string,
  ): Promise<unknown>;
  recordDeliveryFailure(
    key: SourceVersionKey,
    failure: {
      category: SiteDeliveryErrorCategory;
      retryAt: string | null;
      terminal: boolean;
    },
    attemptedAt: string,
  ): Promise<unknown>;
}

interface DeliveryTransport {
  deliver(request: CrowdReportDeliveryRequest): Promise<SiteAcceptedResponse>;
}

export interface SourceDeliveryResult {
  readyCount: number;
  acknowledgedCount: number;
  retryableFailureCount: number;
  terminalFailureCount: number;
  failureCategoryCounts: Partial<Record<SiteDeliveryErrorCategory, number>>;
}

export async function deliverPendingSources(options: {
  repository: DeliveryRepository;
  transport: DeliveryTransport;
  now: () => Date;
  limit?: number;
}): Promise<SourceDeliveryResult> {
  const attemptedAt = readCurrentTimestamp(options.now);
  const deliveries = await options.repository.listReadyDeliveries(
    attemptedAt,
    options.limit,
  );
  const result: SourceDeliveryResult = {
    readyCount: deliveries.length,
    acknowledgedCount: 0,
    retryableFailureCount: 0,
    terminalFailureCount: 0,
    failureCategoryCounts: {},
  };

  for (const delivery of deliveries) {
    try {
      const response = await options.transport.deliver(delivery.request);
      await options.repository.recordDeliveryAcknowledgement(
        delivery.key,
        response,
        attemptedAt,
      );
      result.acknowledgedCount += 1;
    } catch (error) {
      if (!(error instanceof SiteDeliveryError)) throw error;
      await options.repository.recordDeliveryFailure(
        delivery.key,
        {
          category: error.category,
          retryAt: error.retryAt,
          terminal: !error.retryable,
        },
        attemptedAt,
      );
      if (error.retryable) result.retryableFailureCount += 1;
      else result.terminalFailureCount += 1;
      result.failureCategoryCounts[error.category] =
        (result.failureCategoryCounts[error.category] ?? 0) + 1;
    }
  }

  return result;
}

function readCurrentTimestamp(now: () => Date): string {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) {
    throw new TypeError('Invalid current time');
  }
  return value.toISOString();
}
