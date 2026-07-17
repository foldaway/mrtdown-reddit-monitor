# Agent guide

This file is the map, not the manual. Follow links only as needed for the task.

## Start here

- Read [README.md](README.md) for the product boundary and current status.
- Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing runtime boundaries,
  storage, delivery, or dependencies.
- Use [docs/README.md](docs/README.md) to find the source of truth for product,
  reliability, security, design, and planning decisions.
- Check [docs/QUALITY.md](docs/QUALITY.md) before implementation and update its
  gaps when a change materially improves or weakens a quality area.

## Working agreement

1. Inspect the relevant code and source-of-truth document before editing.
2. Keep changes narrow and preserve the acquisition-adapter boundary.
3. For non-trivial work, create an execution plan under
   `docs/exec-plans/active/` using the format in `docs/exec-plans/README.md`.
4. Parse and validate untrusted data at system boundaries. Do not let guessed
   Reddit or site payload shapes flow into domain logic.
5. Never log or fixture raw production Reddit content, usernames, credentials,
   tokens, or full delivery payloads.
6. Add or update deterministic tests with behavior changes.
7. Run `npm run check` before handing work off.
8. Move a finished execution plan to `docs/exec-plans/completed/` and preserve
   its decisions and validation evidence.

## Commands

- `npm ci` — install the locked dependency graph.
- `npm run dev` — run the Worker locally with Wrangler.
- `npm run format` — apply Biome formatting.
- `npm run check` — formatting, lint, types, tests, and repository-doc checks.
- `npm run test:watch` — run Vitest in watch mode while developing.
- `npm run cf-typegen` — regenerate Cloudflare binding types after config
  changes; review the generated diff.

CI must be deterministic and must not call Reddit, `mrtdown-site`, or other
production services.

## Commits and pull requests

Commit subjects and pull request titles must follow Conventional Commits, for
example `test: adopt the Cloudflare Vitest pool`. Keep each subject focused on
the change so release tooling and readers can classify it without opening the
commit.

Every commit created with agent assistance must include this exact trailer
after a blank line at the end of the commit message:

```text
Co-authored-by: Codex <codex@openai.com>
```

## Invariants

- This service discovers and versions Reddit source objects; it does not decide
  whether a disruption is confirmed.
- D1 state changes and matching outbox events must commit atomically.
- Source and event identities are stable and retries are idempotent.
- A stale upsert cannot resurrect a newer deletion.
- Reddit API backoff and rate-limit headers override local polling schedules.
- Raw content retention is bounded; deletion propagation is first-class.
- Secrets and direct author identifiers never enter logs or committed fixtures.

When repeated review feedback reveals a missing rule, update the relevant doc.
If the rule is objective and recurring, encode it in a test, linter, or this
repository's validation script.
