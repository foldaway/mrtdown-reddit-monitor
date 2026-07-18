import type { RedditSourceObject } from '../contracts/reddit-public-json.js';

const encoder = new TextEncoder();

export async function computeContentVersion(
  source: RedditSourceObject,
): Promise<string> {
  return sha256Hex(
    JSON.stringify([
      'reddit-source-v1',
      source.sourceKind,
      source.externalId,
      source.threadExternalId,
      source.parentExternalId,
      source.subreddit,
      source.lifecycle,
      source.sourceUrl,
      source.createdAt,
      source.editedAt,
      source.title,
      source.body,
    ]),
  );
}

export async function computeExternalReportId(
  sourceExternalId: string,
  contentVersion: string,
): Promise<string> {
  const digest = await sha256Hex(
    `reddit-report-v1\0${sourceExternalId}\0${contentVersion}`,
  );
  return `reddit.${digest}`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
