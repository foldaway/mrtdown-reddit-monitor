import { describe, expect, it } from 'vitest';

import { syntheticReferenceCatalog } from '../../test/fixtures/reference-catalog.js';
import {
  parseReferenceCatalog,
  parseReferenceCatalogResponse,
} from './reference-catalog.js';
import { BoundaryValidationError } from './validation.js';

describe('site reference catalog boundary', () => {
  it('parses the authoritative v1 response envelope', () => {
    expect(
      parseReferenceCatalogResponse({
        success: true,
        data: syntheticReferenceCatalog,
      }),
    ).toEqual(syntheticReferenceCatalog);
  });

  it('rejects unsupported schema versions', () => {
    expect(() =>
      parseReferenceCatalog({
        ...syntheticReferenceCatalog,
        schemaVersion: 2,
      }),
    ).toThrowError(
      new BoundaryValidationError('reference_catalog', 'schema_version'),
    );
  });

  it('normalizes strings and rejects unknown fields with stable errors', () => {
    expect(
      parseReferenceCatalog({
        ...syntheticReferenceCatalog,
        datasetVersion: ` ${syntheticReferenceCatalog.datasetVersion} `,
      }).datasetVersion,
    ).toBe(syntheticReferenceCatalog.datasetVersion);

    expect(() =>
      parseReferenceCatalog({
        ...syntheticReferenceCatalog,
        unexpected: true,
      }),
    ).toThrowError(
      new BoundaryValidationError('reference_catalog', 'unknown_field'),
    );
  });

  it('maps Zod issues onto the existing boundary error categories', () => {
    expect(() =>
      parseReferenceCatalog({
        ...syntheticReferenceCatalog,
        referenceDate: '2026-02-30',
      }),
    ).toThrowError(
      new BoundaryValidationError('reference_catalog', 'reference_date'),
    );

    expect(() => parseReferenceCatalogResponse([])).toThrowError(
      new BoundaryValidationError('reference_catalog', 'shape'),
    );
  });

  it('rejects unknown membership references and inactive records', () => {
    expect(() =>
      parseReferenceCatalog({
        ...syntheticReferenceCatalog,
        memberships: [
          {
            ...syntheticReferenceCatalog.memberships[0],
            stationId: 'UNKNOWN',
          },
        ],
      }),
    ).toThrowError(
      new BoundaryValidationError('reference_catalog', 'membership_reference'),
    );
    expect(() =>
      parseReferenceCatalog({
        ...syntheticReferenceCatalog,
        lines: [{ id: 'FUTURE', validFrom: '2027-01-01', validTo: null }],
        stations: [],
        memberships: [],
      }),
    ).toThrowError(
      new BoundaryValidationError('reference_catalog', 'validity'),
    );
  });

  it('retains duplicate and public-code integrity checks', () => {
    expect(() =>
      parseReferenceCatalog({
        ...syntheticReferenceCatalog,
        lines: [
          syntheticReferenceCatalog.lines[0],
          syntheticReferenceCatalog.lines[0],
        ],
      }),
    ).toThrowError(
      new BoundaryValidationError('reference_catalog', 'duplicate_id'),
    );

    expect(() =>
      parseReferenceCatalog({
        ...syntheticReferenceCatalog,
        memberships: [
          syntheticReferenceCatalog.memberships[0],
          syntheticReferenceCatalog.memberships[0],
        ],
      }),
    ).toThrowError(
      new BoundaryValidationError('reference_catalog', 'duplicate_membership'),
    );

    expect(() =>
      parseReferenceCatalog({
        ...syntheticReferenceCatalog,
        stations: syntheticReferenceCatalog.stations.map((station) => ({
          ...station,
          publicCodes: [...station.publicCodes, 'UNMAPPED'],
        })),
      }),
    ).toThrowError(
      new BoundaryValidationError('reference_catalog', 'public_code_reference'),
    );
  });
});
