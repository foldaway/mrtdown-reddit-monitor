# Quality score

Last verified: 2026-07-18

Grades describe evidence in the repository, not intended future behavior.

| Area | Grade | Evidence | Next gap |
| --- | --- | --- | --- |
| Product boundary | A | README and architecture define the post/reply-to-crowd-report boundary; the paired site endpoint is implemented | Validate the boundary during shadow operation |
| Repository legibility | A- | Agent map, architecture map, indexed docs, execution-plan convention | Keep docs fresh as runtime slices appear |
| Static validation | B | Strict TypeScript, Biome, repository-doc validation, one-command check | Enforce module boundaries after modules exist |
| Unit testing | C+ | Deterministic tests cover the rail filter, structured semantic adapter, runtime config, bounded RSS normalization, transport failures, source identities, and site contracts | Add deterministic delivery and Workflow service tests |
| Integration testing | C+ | D1-backed tests cover scheduled discovery and semantic selection, durable backoff, flat snapshots, edits, absence semantics, version evaluation, one Workflow identity, pending delivery, acknowledgement, and content purge | Add delivery and Workflow service integration tests |
| Contract testing | C- | Synthetic consumer tests mirror the site's authoritative request and accepted-response schema | Automate cross-repository contract drift detection if drift recurs |
| Observability | D+ | Scheduled discovery emits redacted discovery and parsing outcome counts with a local content-leak assertion | Add a shared structured event schema plus delivery and Workflow signals |
| Security/privacy | C+ | Boundary validation, prompt/source separation, normalized parser failures, bounded transport errors, author-free normalization, and evaluated/removed content purging are tested | Add retention-window and production secret-rotation checks |
| Deployment safety | D | Deterministic pull-request CI, a test-only config that excludes billable AI access, explicit five-minute cron, and durable public-shadow stop state | Add preview environment, Workflow binding checks, and rollback runbook |

Update this table in the same change that materially changes a grade. Do not
raise a grade based only on a plan or untested implementation.
