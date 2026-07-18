import { describe, expect, it } from 'vitest';

import { parseParserDecision } from '../src/contracts/crowd-report.js';
import {
  parseCrowdReportDeliveryRequest,
  parseSiteAcceptedResponse,
} from '../src/contracts/site.js';
import { BoundaryValidationError } from '../src/contracts/validation.js';

const validReport = {
  reportScope: 'line',
  observedAt: '2026-07-18T08:00:00+08:00',
  lineIds: ['CCL'],
  stationIds: [],
  effect: 'delay',
  delayMinutes: 10,
  isStillHappening: true,
};

describe('parser result boundary', () => {
  it('parses relevant and irrelevant decisions', () => {
    expect(
      parseParserDecision({ decision: 'report', report: validReport }),
    ).toEqual({ decision: 'report', report: validReport });
    expect(parseParserDecision({ decision: 'irrelevant' })).toEqual({
      decision: 'irrelevant',
    });
  });

  it('enforces the site train direction rules', () => {
    expect(() =>
      parseParserDecision({
        decision: 'report',
        report: {
          ...validReport,
          reportScope: 'train',
        },
      }),
    ).toThrowError(
      new BoundaryValidationError('parser_result', 'train_direction'),
    );
  });

  it('rejects parser fields that must not cross the site boundary', () => {
    expect(() =>
      parseParserDecision({
        decision: 'report',
        report: { ...validReport, clientFingerprint: 'not-allowed' },
      }),
    ).toThrowError(
      new BoundaryValidationError('parser_result', 'unknown_field'),
    );
  });
});

describe('site boundary', () => {
  it('parses a bounded Reddit delivery request', () => {
    expect(
      parseCrowdReportDeliveryRequest({
        externalReportId: 'source-version.synthetic-1',
        sourceUrl:
          'https://www.reddit.com/r/singapore/comments/synthetic1/fixture/',
        report: validReport,
      }),
    ).toMatchObject({
      externalReportId: 'source-version.synthetic-1',
      report: validReport,
    });
  });

  it('rejects source URLs outside the allowlisted Reddit origins', () => {
    expect(() =>
      parseCrowdReportDeliveryRequest({
        externalReportId: 'source-version.synthetic-1',
        sourceUrl: 'https://example.invalid/copied-source',
        report: validReport,
      }),
    ).toThrowError(new BoundaryValidationError('site_request', 'source_url'));
  });

  it('validates accepted responses while allowing additive response fields', () => {
    expect(
      parseSiteAcceptedResponse({
        reportId: 'site-report-synthetic-1',
        moderationStatus: 'accepted',
        duplicate: false,
      }),
    ).toEqual({
      reportId: 'site-report-synthetic-1',
      moderationStatus: 'accepted',
    });
  });
});
