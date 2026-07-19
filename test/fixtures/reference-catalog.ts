import type { ReferenceCatalog } from '../../src/contracts/reference-catalog.js';

export const syntheticReferenceCatalog: ReferenceCatalog = {
  schemaVersion: 1,
  datasetVersion: '2026-07-19T00:00:00.000Z',
  referenceDate: '2026-07-19',
  lines: [
    { id: 'BPLRT', validFrom: '1999-11-06', validTo: null },
    { id: 'CCL', validFrom: '2009-05-28', validTo: null },
  ],
  stations: [
    {
      id: 'DBG',
      names: {
        'en-SG': 'Dhoby Ghaut',
        'zh-Hans': '多美歌',
        ms: null,
        ta: null,
      },
      aliases: ['Dhoby Ghaut', '多美歌'],
      publicCodes: ['CC1'],
    },
    {
      id: 'BKP',
      names: {
        'en-SG': 'Bukit Panjang',
        'zh-Hans': null,
        ms: null,
        ta: null,
      },
      aliases: ['Bukit Panjang'],
      publicCodes: ['BP6'],
    },
  ],
  memberships: [
    {
      stationId: 'BKP',
      lineId: 'BPLRT',
      publicCode: 'BP6',
      validFrom: '1999-11-06',
      validTo: null,
    },
    {
      stationId: 'DBG',
      lineId: 'CCL',
      publicCode: 'CC1',
      validFrom: '2010-04-17',
      validTo: null,
    },
  ],
};
