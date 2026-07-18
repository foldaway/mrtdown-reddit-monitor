# Security and privacy

Status: Required controls; implementation incomplete

Last verified: 2026-07-18

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
- Do not persist usernames unless a demonstrated deduplication requirement
  justifies a pseudonymous, short-lived replacement.
- Bound stored title/body retention and purge removed content.
- Restrict source permalinks to allowed Reddit HTTPS origins.

## Logging

Use safe metadata such as counts, internal IDs, durations, status codes, and
error categories. Normalize transport errors so response bodies,
authorization headers, post bodies, reply bodies, and full site request
payloads are not logged accidentally.

## Release gates

Before production access, review current Reddit terms and deletion guidance,
validate producer-secret rotation, verify least-privilege Cloudflare bindings,
test bounded source-content deletion, and document credential failure and
rotation.

Report vulnerabilities privately to the repository owner; do not open a public
issue containing credentials, personal data, or exploitable details.
