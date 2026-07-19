# Quality score

Last verified: 2026-07-19

Grades describe evidence in the repository, not intended future behavior.

| Area | Grade | Evidence | Next gap |
| --- | --- | --- | --- |
| Product boundary | A | README and architecture define the post/reply-to-crowd-report boundary; the paired site endpoint is implemented | Validate the boundary during shadow operation |
| Repository legibility | A- | Agent map, architecture map, indexed docs, execution-plan convention | Keep docs fresh as runtime slices appear |
| Static validation | B | Strict TypeScript, Biome, repository-doc validation, one-command check | Enforce module boundaries after modules exist |
| Unit testing | C+ | Deterministic tests cover the rail filter, catalog-grounded semantic adapter, runtime config, bounded Reddit/site/catalog transports, source identities, and site contracts | Add deterministic Workflow service tests |
| Integration testing | C+ | D1-backed tests cover scheduled discovery, semantic selection, reference-catalog caching, Reddit backoff, snapshots, version evaluation, site delivery retry/terminal state, acknowledgement, and content purge | Add Workflow service integration tests |
| Contract testing | C- | Synthetic consumer tests mirror the site's authoritative request and accepted-response schema; the nested reference catalog uses a strict consumer-owned Zod schema | Automate cross-repository contract drift detection if drift recurs |
| Observability | D+ | Scheduled discovery emits redacted discovery, parsing, delivery, and failure-category counts with local content-leak assertions | Add a shared structured event schema plus Workflow signals and pending-age metrics |
| Security/privacy | C+ | Boundary validation, trusted-catalog/source prompt separation, normalized parser failures, bounded transport errors, author-free normalization, and evaluated/removed content purging are tested | Add retention-window and production secret-rotation checks |
| Deployment safety | D | Deterministic pull-request CI, a test-only config that excludes billable AI access, explicit five-minute cron, and durable public-shadow stop state | Add preview environment, Workflow binding checks, and rollback runbook |

Update this table in the same change that materially changes a grade. Do not
raise a grade based only on a plan or untested implementation.
