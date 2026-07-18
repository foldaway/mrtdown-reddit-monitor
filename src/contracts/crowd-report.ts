import {
  fail,
  parseIsoTimestamp,
  parseRecord,
  parseString,
  rejectUnknownKeys,
} from './validation.js';

const BOUNDARY = 'parser_result';

export const CROWD_REPORT_EFFECTS = [
  'delay',
  'no-service',
  'crowding',
  'skipped-stop',
  'unknown',
] as const;

export type CrowdReportEffect = (typeof CROWD_REPORT_EFFECTS)[number];
export type CrowdReportScope = 'line' | 'station' | 'train';

export interface CrowdReport {
  reportScope: CrowdReportScope;
  observedAt: string;
  lineIds: string[];
  stationIds: string[];
  directionStationId?: string;
  directionUnknown?: boolean;
  effect: CrowdReportEffect;
  delayMinutes?: number;
  isStillHappening?: boolean;
}

export type ParserDecision =
  | { decision: 'irrelevant' }
  | { decision: 'report'; report: CrowdReport };

export function parseParserDecision(input: unknown): ParserDecision {
  const value = parseRecord(input, BOUNDARY);
  if (value.decision === 'irrelevant') {
    rejectUnknownKeys(value, ['decision'], BOUNDARY);
    return { decision: 'irrelevant' };
  }
  if (value.decision !== 'report') fail(BOUNDARY, 'decision');
  rejectUnknownKeys(value, ['decision', 'report'], BOUNDARY);
  return { decision: 'report', report: parseCrowdReport(value.report) };
}

export function parseCrowdReport(input: unknown): CrowdReport {
  const value = parseRecord(input, BOUNDARY, 'report_shape');
  rejectUnknownKeys(
    value,
    [
      'reportScope',
      'observedAt',
      'lineIds',
      'stationIds',
      'directionStationId',
      'directionUnknown',
      'effect',
      'delayMinutes',
      'isStillHappening',
    ],
    BOUNDARY,
  );

  const reportScope = parseScope(value.reportScope);
  const lineIds = parseIds(value.lineIds, 'line_ids', 8);
  const stationIds = parseIds(value.stationIds, 'station_ids', 16);
  const directionStationId = parseOptionalId(
    value.directionStationId,
    'direction_station_id',
  );
  const directionUnknown = parseOptionalBoolean(
    value.directionUnknown,
    'direction_unknown',
  );

  validateScope(
    reportScope,
    lineIds,
    stationIds,
    directionStationId,
    directionUnknown,
  );

  const delayMinutes = parseOptionalDelay(value.delayMinutes);
  const isStillHappening = parseOptionalBoolean(
    value.isStillHappening,
    'is_still_happening',
  );

  return {
    reportScope,
    observedAt: parseIsoTimestamp(value.observedAt, BOUNDARY, 'observed_at'),
    lineIds,
    stationIds,
    ...(directionStationId === undefined ? {} : { directionStationId }),
    ...(directionUnknown === undefined ? {} : { directionUnknown }),
    effect: parseEffect(value.effect),
    ...(delayMinutes === undefined ? {} : { delayMinutes }),
    ...(isStillHappening === undefined ? {} : { isStillHappening }),
  };
}

function parseScope(input: unknown): CrowdReportScope {
  if (input !== 'line' && input !== 'station' && input !== 'train') {
    fail(BOUNDARY, 'report_scope');
  }
  return input;
}

function parseEffect(input: unknown): CrowdReportEffect {
  if (
    typeof input !== 'string' ||
    !CROWD_REPORT_EFFECTS.includes(input as CrowdReportEffect)
  ) {
    fail(BOUNDARY, 'effect');
  }
  return input as CrowdReportEffect;
}

function parseIds(input: unknown, code: string, maximum: number): string[] {
  if (!Array.isArray(input) || input.length > maximum) fail(BOUNDARY, code);
  const ids = input.map((id) =>
    parseString(id, BOUNDARY, code, { maximumLength: 64 }),
  );
  if (new Set(ids).size !== ids.length) fail(BOUNDARY, code);
  return ids;
}

function parseOptionalId(input: unknown, code: string): string | undefined {
  return input === undefined
    ? undefined
    : parseString(input, BOUNDARY, code, { maximumLength: 64 });
}

function parseOptionalBoolean(
  input: unknown,
  code: string,
): boolean | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== 'boolean') fail(BOUNDARY, code);
  return input;
}

function parseOptionalDelay(input: unknown): number | undefined {
  if (input === undefined) return undefined;
  if (
    !Number.isInteger(input) ||
    (input as number) < 0 ||
    (input as number) > 180
  ) {
    fail(BOUNDARY, 'delay_minutes');
  }
  return input as number;
}

function validateScope(
  scope: CrowdReportScope,
  lineIds: string[],
  stationIds: string[],
  directionStationId: string | undefined,
  directionUnknown: boolean | undefined,
): void {
  if (lineIds.length === 0 && stationIds.length === 0) {
    fail(BOUNDARY, 'affected_area');
  }
  if (scope === 'line' && lineIds.length === 0) {
    fail(BOUNDARY, 'line_scope');
  }
  if (scope === 'station' && stationIds.length === 0) {
    fail(BOUNDARY, 'station_scope');
  }
  if (scope === 'train' && lineIds.length !== 1) {
    fail(BOUNDARY, 'train_line');
  }
  if (
    scope === 'train' &&
    directionStationId === undefined &&
    directionUnknown !== true
  ) {
    fail(BOUNDARY, 'train_direction');
  }
  if (scope !== 'train' && directionStationId !== undefined) {
    fail(BOUNDARY, 'direction_station_scope');
  }
  if (scope !== 'train' && directionUnknown !== undefined) {
    fail(BOUNDARY, 'direction_unknown_scope');
  }
  if (directionStationId !== undefined && directionUnknown === true) {
    fail(BOUNDARY, 'direction_conflict');
  }
}
