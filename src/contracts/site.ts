import { parseCrowdReport, type CrowdReport } from './crowd-report.js';
import {
  fail,
  parseHttpUrl,
  parseRecord,
  parseString,
  rejectUnknownKeys,
} from './validation.js';

const REQUEST_BOUNDARY = 'site_request';
const RESPONSE_BOUNDARY = 'site_response';
const REDDIT_ORIGINS = new Set([
  'https://reddit.com',
  'https://www.reddit.com',
]);
const MODERATION_STATUSES = [
  'pending',
  'accepted',
  'rejected',
  'duplicate',
  'dispatched',
] as const;

export interface CrowdReportDeliveryRequest {
  externalReportId: string;
  sourceUrl?: string;
  report: CrowdReport;
}

export interface SiteAcceptedResponse {
  reportId: string;
  moderationStatus: (typeof MODERATION_STATUSES)[number];
}

export function parseCrowdReportDeliveryRequest(
  input: unknown,
): CrowdReportDeliveryRequest {
  const value = parseRecord(input, REQUEST_BOUNDARY);
  rejectUnknownKeys(
    value,
    ['externalReportId', 'sourceUrl', 'report'],
    REQUEST_BOUNDARY,
  );
  const sourceUrl =
    value.sourceUrl === undefined
      ? undefined
      : parseHttpUrl(
          value.sourceUrl,
          REQUEST_BOUNDARY,
          'source_url',
          REDDIT_ORIGINS,
        );
  return {
    externalReportId: parseOpaqueId(value.externalReportId),
    ...(sourceUrl === undefined ? {} : { sourceUrl }),
    report: parseCrowdReport(value.report),
  };
}

export function parseSiteAcceptedResponse(
  input: unknown,
): SiteAcceptedResponse {
  const value = parseRecord(input, RESPONSE_BOUNDARY);
  const moderationStatus = value.moderationStatus;
  if (
    typeof moderationStatus !== 'string' ||
    !MODERATION_STATUSES.includes(
      moderationStatus as SiteAcceptedResponse['moderationStatus'],
    )
  ) {
    fail(RESPONSE_BOUNDARY, 'moderation_status');
  }
  return {
    reportId: parseString(value.reportId, RESPONSE_BOUNDARY, 'report_id', {
      maximumLength: 256,
    }),
    moderationStatus:
      moderationStatus as SiteAcceptedResponse['moderationStatus'],
  };
}

function parseOpaqueId(input: unknown): string {
  const value = parseString(input, REQUEST_BOUNDARY, 'external_report_id', {
    maximumLength: 128,
  });
  if (!/^[A-Za-z0-9._~-]+$/.test(value)) {
    fail(REQUEST_BOUNDARY, 'external_report_id');
  }
  return value;
}
