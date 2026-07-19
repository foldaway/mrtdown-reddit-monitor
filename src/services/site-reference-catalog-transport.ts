import {
  parseReferenceCatalogResponse,
  type ReferenceCatalog,
} from '../contracts/reference-catalog.js';

const MAXIMUM_RESPONSE_BYTES = 512 * 1_024;
const DEFAULT_MAX_AGE_SECONDS = 300;
const MAXIMUM_MAX_AGE_SECONDS = 3_600;

export type ReferenceCatalogTransportErrorCategory =
  | 'authentication'
  | 'invalid_content_type'
  | 'invalid_response'
  | 'network'
  | 'response_too_large'
  | 'server'
  | 'unexpected_status';

export class ReferenceCatalogTransportError extends Error {
  constructor(
    readonly category: ReferenceCatalogTransportErrorCategory,
    readonly retryable: boolean,
    readonly status: number | null,
  ) {
    super(`Reference catalog transport failed: ${category}`);
    this.name = 'ReferenceCatalogTransportError';
  }
}

export interface ReferenceCatalogFetchResult {
  catalog: ReferenceCatalog;
  maxAgeSeconds: number;
}

export class SiteReferenceCatalogTransport {
  private readonly maximumResponseBytes: number;

  constructor(
    private readonly options: {
      fetch: typeof fetch;
      url: string;
      token: string;
      maximumResponseBytes?: number;
    },
  ) {
    let url: URL;
    try {
      url = new URL(options.url);
    } catch {
      throw new TypeError('Invalid reference catalog configuration');
    }
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      /[\r\n]/.test(options.token) ||
      options.token.trim().length === 0
    ) {
      throw new TypeError('Invalid reference catalog configuration');
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

  async fetchCatalog(): Promise<ReferenceCatalogFetchResult> {
    let response: Response;
    try {
      response = await this.options.fetch(
        new Request(this.options.url, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${this.options.token}`,
          },
          redirect: 'manual',
        }),
      );
    } catch {
      throw new ReferenceCatalogTransportError('network', true, null);
    }

    if (response.status !== 200) throw statusError(response.status);
    if (!isJsonContentType(response.headers.get('content-type'))) {
      throw new ReferenceCatalogTransportError(
        'invalid_content_type',
        false,
        response.status,
      );
    }
    try {
      return {
        catalog: parseReferenceCatalogResponse(
          JSON.parse(
            await readBoundedBody(response, this.maximumResponseBytes),
          ),
        ),
        maxAgeSeconds: parseMaxAge(response.headers.get('cache-control')),
      };
    } catch (error) {
      if (error instanceof ReferenceCatalogTransportError) throw error;
      throw new ReferenceCatalogTransportError(
        'invalid_response',
        false,
        response.status,
      );
    }
  }
}

function statusError(status: number): ReferenceCatalogTransportError {
  if (status === 401 || status === 403) {
    return new ReferenceCatalogTransportError('authentication', false, status);
  }
  if (status >= 500 && status <= 599) {
    return new ReferenceCatalogTransportError('server', true, status);
  }
  return new ReferenceCatalogTransportError('unexpected_status', false, status);
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
    throw new ReferenceCatalogTransportError(
      'response_too_large',
      false,
      response.status,
    );
  }
  if (response.body === null) {
    throw new ReferenceCatalogTransportError(
      'invalid_response',
      false,
      response.status,
    );
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
        throw new ReferenceCatalogTransportError(
          'response_too_large',
          false,
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

function parseMaxAge(value: string | null): number {
  const match = value?.match(/(?:^|,)\s*max-age=(\d+)\s*(?:,|$)/i);
  if (match === null || match === undefined) return DEFAULT_MAX_AGE_SECONDS;
  const seconds = Number(match[1]);
  if (!Number.isSafeInteger(seconds) || seconds < 1) {
    return DEFAULT_MAX_AGE_SECONDS;
  }
  return Math.min(seconds, MAXIMUM_MAX_AGE_SECONDS);
}
