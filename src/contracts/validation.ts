export class BoundaryValidationError extends Error {
  constructor(
    readonly boundary: string,
    readonly code: string,
  ) {
    super(`${boundary} rejected: ${code}`);
    this.name = 'BoundaryValidationError';
  }
}

export function fail(boundary: string, code: string): never {
  throw new BoundaryValidationError(boundary, code);
}

export function isRecord(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input);
}

export function parseRecord(
  input: unknown,
  boundary: string,
  code = 'shape',
): Record<string, unknown> {
  if (!isRecord(input)) fail(boundary, code);
  return input;
}

export function rejectUnknownKeys(
  input: Record<string, unknown>,
  allowedKeys: readonly string[],
  boundary: string,
): void {
  const allowed = new Set(allowedKeys);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    fail(boundary, 'unknown_field');
  }
}

export function parseString(
  input: unknown,
  boundary: string,
  code: string,
  options: { minimumLength?: number; maximumLength?: number } = {},
): string {
  if (typeof input !== 'string') fail(boundary, code);
  const value = input.trim();
  if (
    value.length < (options.minimumLength ?? 1) ||
    value.length > (options.maximumLength ?? Number.POSITIVE_INFINITY)
  ) {
    fail(boundary, code);
  }
  return value;
}

export function parseHttpUrl(
  input: unknown,
  boundary: string,
  code: string,
  allowedOrigins?: ReadonlySet<string>,
): string {
  const value = parseString(input, boundary, code, { maximumLength: 2_048 });
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail(boundary, code);
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== '' ||
    (allowedOrigins !== undefined && !allowedOrigins.has(url.origin))
  ) {
    fail(boundary, code);
  }
  return url.toString();
}

export function parseIsoTimestamp(
  input: unknown,
  boundary: string,
  code: string,
): string {
  const value = parseString(input, boundary, code, { maximumLength: 64 });
  if (
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    fail(boundary, code);
  }
  return value;
}
