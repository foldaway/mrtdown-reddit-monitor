import { z } from 'zod';

import { fail } from './validation.js';

const BOUNDARY = 'reference_catalog';

const trimmedString = (maximumLength: number) =>
  z.string().trim().min(1).max(maximumLength);

const isoDateSchema = trimmedString(10)
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
    );
  });

const isoTimestampSchema = trimmedString(64).refine(
  (value) =>
    /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value)),
);

const uniqueStringArray = (maximumItems: number, maximumLength: number) =>
  z
    .array(trimmedString(maximumLength))
    .max(maximumItems)
    .refine((values) => new Set(values).size === values.length);

const referenceCatalogLineSchema = z.strictObject({
  id: trimmedString(64),
  validFrom: isoDateSchema,
  validTo: isoDateSchema.nullable(),
});

const referenceCatalogStationSchema = z.strictObject({
  id: trimmedString(64),
  names: z
    .record(trimmedString(32), z.union([trimmedString(200), z.null()]))
    .refine((names) => Object.keys(names).length <= 16),
  aliases: uniqueStringArray(16, 200),
  publicCodes: uniqueStringArray(16, 64),
});

const referenceCatalogMembershipSchema = z.strictObject({
  stationId: trimmedString(64),
  lineId: trimmedString(64),
  publicCode: trimmedString(64),
  validFrom: isoDateSchema,
  validTo: isoDateSchema.nullable(),
});

const referenceCatalogSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    datasetVersion: isoTimestampSchema,
    referenceDate: isoDateSchema,
    lines: z.array(referenceCatalogLineSchema).max(32),
    stations: z.array(referenceCatalogStationSchema).max(512),
    memberships: z.array(referenceCatalogMembershipSchema).max(1_024),
  })
  .superRefine((catalog, context) => {
    const lineIds = new Set(catalog.lines.map((line) => line.id));
    const stationIds = new Set(catalog.stations.map((station) => station.id));
    if (
      lineIds.size !== catalog.lines.length ||
      stationIds.size !== catalog.stations.length
    ) {
      addIntegrityIssue(context, 'duplicate_id');
      return;
    }

    for (const item of [...catalog.lines, ...catalog.memberships]) {
      if (
        item.validFrom > catalog.referenceDate ||
        (item.validTo !== null && item.validTo < catalog.referenceDate) ||
        (item.validTo !== null && item.validTo < item.validFrom)
      ) {
        addIntegrityIssue(context, 'validity');
        return;
      }
    }

    const membershipKeys = new Set<string>();
    const membershipCodesByStation = new Map<string, Set<string>>();
    const publicCodesByStation = new Map(
      catalog.stations.map((station) => [
        station.id,
        new Set(station.publicCodes),
      ]),
    );
    for (const membership of catalog.memberships) {
      if (
        !lineIds.has(membership.lineId) ||
        !stationIds.has(membership.stationId) ||
        !publicCodesByStation
          .get(membership.stationId)
          ?.has(membership.publicCode)
      ) {
        addIntegrityIssue(context, 'membership_reference');
        return;
      }

      const key = `${membership.stationId}\u0000${membership.lineId}\u0000${membership.publicCode}`;
      if (membershipKeys.has(key)) {
        addIntegrityIssue(context, 'duplicate_membership');
        return;
      }
      membershipKeys.add(key);

      const codes =
        membershipCodesByStation.get(membership.stationId) ?? new Set<string>();
      codes.add(membership.publicCode);
      membershipCodesByStation.set(membership.stationId, codes);
    }

    for (const station of catalog.stations) {
      const membershipCodes = membershipCodesByStation.get(station.id);
      if (
        station.publicCodes.some(
          (publicCode) => !membershipCodes?.has(publicCode),
        )
      ) {
        addIntegrityIssue(context, 'public_code_reference');
        return;
      }
    }
  });

const referenceCatalogResponseSchema = z.object({
  success: z.literal(true),
  data: z.unknown(),
});

export type ReferenceCatalogLine = z.infer<typeof referenceCatalogLineSchema>;
export type ReferenceCatalogStation = z.infer<
  typeof referenceCatalogStationSchema
>;
export type ReferenceCatalogMembership = z.infer<
  typeof referenceCatalogMembershipSchema
>;
export type ReferenceCatalog = z.infer<typeof referenceCatalogSchema>;

export function parseReferenceCatalogResponse(
  input: unknown,
): ReferenceCatalog {
  const response = referenceCatalogResponseSchema.safeParse(input);
  if (!response.success) {
    const issue = response.error.issues[0];
    fail(BOUNDARY, issue?.path[0] === 'success' ? 'success' : 'shape');
  }
  return parseReferenceCatalog(response.data.data);
}

export function parseReferenceCatalog(input: unknown): ReferenceCatalog {
  const result = referenceCatalogSchema.safeParse(input);
  if (!result.success) {
    fail(BOUNDARY, mapCatalogIssue(result.error.issues[0]));
  }
  return result.data;
}

function addIntegrityIssue(
  context: z.RefinementCtx,
  code: IntegrityCode,
): void {
  context.addIssue({ code: 'custom', message: code });
}

const integrityCodes = new Set([
  'duplicate_id',
  'validity',
  'membership_reference',
  'duplicate_membership',
  'public_code_reference',
] as const);

type IntegrityCode =
  | 'duplicate_id'
  | 'validity'
  | 'membership_reference'
  | 'duplicate_membership'
  | 'public_code_reference';

interface CatalogIssue {
  readonly code: string;
  readonly message: string;
  readonly path: readonly PropertyKey[];
}

function mapCatalogIssue(issue: CatalogIssue | undefined): string {
  if (issue === undefined) return 'data';
  if (issue.code === 'unrecognized_keys') return 'unknown_field';
  if (
    issue.code === 'custom' &&
    integrityCodes.has(issue.message as IntegrityCode)
  ) {
    return issue.message;
  }

  const [section, item, field] = issue.path;
  if (section === 'schemaVersion') return 'schema_version';
  if (section === 'datasetVersion') return 'dataset_version';
  if (section === 'referenceDate') return 'reference_date';
  if (section === 'lines') {
    if (typeof item !== 'number') return 'lines';
    if (field === 'id') return 'line_id';
    if (field === 'validFrom') return 'valid_from';
    if (field === 'validTo') return 'valid_to';
    return 'line';
  }
  if (section === 'stations') {
    if (typeof item !== 'number') return 'stations';
    if (field === 'id') return 'station_id';
    if (field === 'aliases') return 'aliases';
    if (field === 'publicCodes') return 'public_codes';
    if (field === 'names') {
      if (issue.code === 'invalid_key') return 'locale';
      return issue.path.length > 3 ? 'name' : 'names';
    }
    return 'station';
  }
  if (section === 'memberships') {
    if (typeof item !== 'number') return 'memberships';
    if (field === 'stationId') return 'station_id';
    if (field === 'lineId') return 'line_id';
    if (field === 'publicCode') return 'public_code';
    if (field === 'validFrom') return 'valid_from';
    if (field === 'validTo') return 'valid_to';
    return 'membership';
  }
  return 'data';
}
