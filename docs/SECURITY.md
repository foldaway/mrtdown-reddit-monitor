# Security and privacy

Status: Boundary, prompt, source-content, delivery, and public-shadow controls implemented

Last verified: 2026-07-20

## Trust boundaries

Treat Reddit responses, environment variables, D1 rows, parser output, clock
values, and site responses as untrusted. Parse them into explicit types at the
boundary. Authenticate both the production Reddit client and the site
programmatic-report request.

## Sensitive data

- Store credentials only in Cloudflare secrets or ignored local secret files.
- Never commit `.dev.vars`, tokens, production IDs, or real Reddit content.
- Never send usernames, profiles, avatars, flair, or conversation structure to
  the site.
- Ignore RSS author and generated-comment-title fields, and do not reconstruct
  missing parent relationships from comment text or follow-up requests.
- Do not persist usernames unless a demonstrated deduplication requirement
  justifies a pseudonymous, short-lived replacement.
- Bound stored title/body retention and purge removed content.
- Restrict source permalinks to allowed Reddit HTTPS origins.
- Place source text only in the semantic parser's untrusted user message,
  validate every structured model decision, and normalize failures without
  source content.
- Keep public-shadow pause and stop decisions durable. Authentication, block,
  unexpected-content-type, repeated-rate-limit, and sustained-shape failures
  must prevent later scheduled requests until the state is deliberately reset.
- Send the site credential only to the configured HTTPS ingest URL with manual
  redirect handling. Bound and validate accepted response bodies, and persist
  only normalized site failure categories rather than response content.
- Require the authenticated reference-catalog URL to share the ingest origin.
  Keep catalog data in a trusted system message, source text in the untrusted
  user message, and reject model identifiers absent from active memberships.

## Logging

Use safe metadata such as counts, durations, status codes, and error
categories. Aggregate D1 metrics may include only freshness or pending ages,
state counts, and normalized Reddit access state. Normalize transport errors so response bodies,
authorization headers, post bodies, reply bodies, and full site request
payloads are not logged accidentally.

The test configuration deliberately omits the Workers AI binding so local and
CI validation cannot make billable inference calls.

## Release gates

Before production access, review current Reddit terms and deletion guidance,
validate producer-secret rotation, verify least-privilege Cloudflare bindings,
extend the tested evaluation/removal purge behavior with a time-based retention
window, and document credential failure and rotation.

Report vulnerabilities privately to the repository owner; do not open a public
issue containing credentials, personal data, or exploitable details.
