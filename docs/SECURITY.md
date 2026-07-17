# Security and privacy

Status: Required controls; implementation incomplete

Last verified: 2026-07-17

## Trust boundaries

Treat Reddit responses, environment variables, D1 rows, clock values, and site
responses as untrusted inputs. Parse them into explicit internal types at the
boundary. Authenticate both the Reddit client and site-ingest transport.

## Sensitive data

- Store credentials only in Cloudflare secrets or local ignored secret files.
- Never commit `.dev.vars`, tokens, production IDs, or real user content.
- Never deliver or log usernames, profiles, avatars, flair, raw payloads, or
  complete event batches.
- Derive author keys with a secret-keyed HMAC, not an enumerable plain hash.
- Bound raw title/body retention and preserve only minimal deletion/idempotency
  tombstones after expiry.

## Logging

Use structured event names and safe metadata such as counts, stable internal
IDs, durations, status codes, and error categories. Errors from transports must
be normalized so response bodies and authorization headers are not logged by
accident.

## Release gates

Before production access, review current Reddit terms and deletion guidance,
agree the ingest authentication and rotation contract, test content purge and
deletion propagation, verify least-privilege Cloudflare bindings, and document
incident response and credential rotation.

Report vulnerabilities privately to the repository owner; do not open a public
issue containing credentials, personal data, or exploitable details.
