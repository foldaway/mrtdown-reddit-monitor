import { describe, expect, it } from 'vitest';

import { syntheticReferenceCatalog } from '../../test/fixtures/reference-catalog.js';
import type { CrowdReport } from '../contracts/crowd-report.js';
import { areCrowdReportReferencesValid } from './reference-catalog.js';

const report: CrowdReport = {
  reportScope: 'train',
  observedAt: '2026-07-19T01:00:00.000Z',
  lineIds: ['CCL'],
  stationIds: ['DBG'],
  directionStationId: 'DBG',
  effect: 'delay',
};

describe('crowd-report reference validation', () => {
  it('accepts active entity IDs and memberships', () => {
    expect(
      areCrowdReportReferencesValid(report, syntheticReferenceCatalog),
    ).toBe(true);
  });

  it('rejects public codes, unknown lines, and cross-line directions', () => {
    expect(
      areCrowdReportReferencesValid(
        { ...report, stationIds: ['CC1'], directionStationId: 'CC1' },
        syntheticReferenceCatalog,
      ),
    ).toBe(false);
    expect(
      areCrowdReportReferencesValid(
        { ...report, lineIds: ['UNKNOWN'] },
        syntheticReferenceCatalog,
      ),
    ).toBe(false);
    expect(
      areCrowdReportReferencesValid(
        { ...report, directionStationId: 'BKP' },
        syntheticReferenceCatalog,
      ),
    ).toBe(false);
  });
});
