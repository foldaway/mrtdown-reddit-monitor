import type { CrowdReport } from '../contracts/crowd-report.js';
import type { ReferenceCatalog } from '../contracts/reference-catalog.js';

export function areCrowdReportReferencesValid(
  report: CrowdReport,
  catalog: ReferenceCatalog,
): boolean {
  const lineIds = new Set(catalog.lines.map((line) => line.id));
  const stationIds = new Set(catalog.stations.map((station) => station.id));
  if (
    report.lineIds.some((lineId) => !lineIds.has(lineId)) ||
    report.stationIds.some((stationId) => !stationIds.has(stationId))
  ) {
    return false;
  }

  const membershipKeys = new Set(
    catalog.memberships.map(
      (membership) => `${membership.lineId}\u0000${membership.stationId}`,
    ),
  );
  if (report.reportScope !== 'station' && report.lineIds.length > 0) {
    for (const stationId of report.stationIds) {
      const valid =
        report.reportScope === 'line'
          ? report.lineIds.some((lineId) =>
              membershipKeys.has(`${lineId}\u0000${stationId}`),
            )
          : report.lineIds.every((lineId) =>
              membershipKeys.has(`${lineId}\u0000${stationId}`),
            );
      if (!valid) return false;
    }
  }

  return (
    report.directionStationId === undefined ||
    (stationIds.has(report.directionStationId) &&
      report.lineIds.length === 1 &&
      membershipKeys.has(
        `${report.lineIds[0]}\u0000${report.directionStationId}`,
      ))
  );
}

export function serializeReferenceCatalogForPrompt(
  catalog: ReferenceCatalog,
): string {
  const lineIdsByStation = new Map<string, string[]>();
  for (const membership of catalog.memberships) {
    const lineIds = lineIdsByStation.get(membership.stationId) ?? [];
    if (!lineIds.includes(membership.lineId)) lineIds.push(membership.lineId);
    lineIdsByStation.set(membership.stationId, lineIds);
  }
  return JSON.stringify({
    referenceDate: catalog.referenceDate,
    lineIds: catalog.lines.map((line) => line.id),
    stations: catalog.stations.map((station) => ({
      id: station.id,
      aliases: station.aliases,
      publicCodes: station.publicCodes,
      lineIds: lineIdsByStation.get(station.id) ?? [],
    })),
  });
}
