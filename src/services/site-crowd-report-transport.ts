import {
  parseCrowdReportDeliveryRequest,
  parseSiteAcceptedResponse,
  type CrowdReportDeliveryRequest,
  type SiteDeliveryErrorCategory,
  type SiteAcceptedResponse,
} from '../contracts/site.js';

const MAXIMUM_RESPONSE_BYTES = 64 * 1_024;

export class SiteDeliveryError extends Error {
  constructor(
    readonly category: SiteDeliveryErrorCategory,
    readonly retryable: boolean,
    readonly status: number | null,
    readonly retryAt: string | null = null,
  ) {
    super(`Site delivery failed: ${category}`);
    this.name = 'SiteDeliveryError';
  }
}

export interface SiteCrowdReportTransportOptions {
  fetch: typeof fetch;
  ingestUrl: string;
  ingestToken: string;
  now: () => Date;
  maximumResponseBytes?: number;
}

export class SiteCrowdReportTransport {
  private readonly maximumResponseBytes: number;

  constructor(private readonly options: SiteCrowdReportTransportOptions) {
    let url: URL;
    try {
      url = new URL(options.ingestUrl);
    } catch {
      throw new TypeError('Invalid site delivery configuration');
    }
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      /[\r\n]/.test(options.ingestToken) ||
      options.ingestToken.trim().length === 0
    ) {
      throw new TypeError('Invalid site delivery configuration');
    }
    this.maximumResponseBytes =
      options.maximumResponseBytes ?? MAXIMUM_RESPONSE_BYTES;
    if (
      !Number.isSafeInteger(this.maximumResponseBytes) ||
      this.maximumResponseBytes < 1 ||
      this.maximumResponseBytes > MAXIMUM_RESPONSE_BYTES
    ) {
      throw new TypeError('Invalid maximum response bytes');
    }
  }

  async deliver(
    requestInput: CrowdReportDeliveryRequest,
  ): Promise<SiteAcceptedResponse> {
    const request = parseCrowdReportDeliveryRequest(requestInput);
    let response: Response;
    try {
      response = await this.options.fetch(
        new Request(this.options.ingestUrl, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${this.options.ingestToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request),
          redirect: 'manual',
        }),
      );
    } catch {
      throw new SiteDeliveryError('network', true, null);
    }

    const retryAt = parseRetryAfter(
      response.headers.get('retry-after'),
      readCurrentTime(this.options.now),
    );
    if (response.status !== 202) {
      throw statusError(response.status, retryAt);
    }
    if (!isJsonContentType(response.headers.get('content-type'))) {
      throw new SiteDeliveryError(
        'invalid_content_type',
        true,
        response.status,
      );
    }

    let input: unknown;
    try {
      input = JSON.parse(
        await readBoundedBody(response, this.maximumResponseBytes),
      );
      return parseSiteAcceptedResponse(input);
    } catch (error) {
      if (error instanceof SiteDeliveryError) throw error;
      throw new SiteDeliveryError('invalid_response', true, response.status);
    }
  }
}

function statusError(
  status: number,
  retryAt: string | null,
): SiteDeliveryError {
  if (status === 400) {
    return new SiteDeliveryError('invalid_request', false, status);
  }
  if (status === 401 || status === 403) {
    return new SiteDeliveryError('authentication', false, status);
  }
  if (status === 409) {
    return new SiteDeliveryError('idempotency_conflict', false, status);
  }
  if (status === 408 || status === 425 || status === 429) {
    return new SiteDeliveryError('rate_limited', true, status, retryAt);
  }
  if (status >= 500 && status <= 599) {
    return new SiteDeliveryError('server', true, status, retryAt);
  }
  return new SiteDeliveryError('unexpected_status', false, status);
}

async function readBoundedBody(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (
    contentLength !== null &&
    /^\d+$/.test(contentLength) &&
    Number(contentLength) > maximumBytes
  ) {
    throw new SiteDeliveryError('response_too_large', true, response.status);
  }
  if (response.body === null) {
    throw new SiteDeliveryError('invalid_response', true, response.status);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new SiteDeliveryError(
          'response_too_large',
          true,
          response.status,
        );
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(body);
}

function isJsonContentType(value: string | null): boolean {
  return value?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json';
}

function readCurrentTime(now: () => Date): number {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.valueOf())) {
    throw new TypeError('Invalid current time');
  }
  return value.valueOf();
}

function parseRetryAfter(value: string | null, now: number): string | null {
  if (value === null || value.length > 128) return null;
  const seconds = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  const retryAt = Number.isSafeInteger(seconds)
    ? now + seconds * 1_000
    : Date.parse(value);
  if (
    !Number.isFinite(retryAt) ||
    retryAt <= now ||
    retryAt > 8_640_000_000_000_000
  ) {
    return null;
  }
  return new Date(retryAt).toISOString();
}
