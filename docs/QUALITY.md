# Quality score

Last verified: 2026-07-18

Grades describe evidence in the repository, not intended future behavior.

| Area | Grade | Evidence | Next gap |
| --- | --- | --- | --- |
| Product boundary | A | README and architecture define the post/reply-to-crowd-report boundary | Implement the paired site endpoint |
| Repository legibility | A- | Agent map, architecture map, indexed docs, execution-plan convention | Keep docs fresh as runtime slices appear |
| Static validation | B | Strict TypeScript, Biome, repository-doc validation, one-command check | Enforce module boundaries after modules exist |
| Unit testing | C | Deterministic tests cover runtime config, parser output, Reddit conversation normalization and transport failure modes, source identities, and site requests/responses | Add deterministic service tests with each discovery and Workflow slice |
| Integration testing | C | D1-backed tests cover repeated storage, version evaluation, one Workflow identity, pending delivery, acknowledgement, and content purge | Add service-level discovery and Workflow integration tests |
| Contract testing | D | Synthetic consumer tests enforce the planned site request and acknowledgement shapes | Reconcile tests with the site's authoritative schema when its endpoint lands |
| Observability | D | Cloudflare logs enabled and required signals documented | Add structured, redacted event schema and local assertions |
| Security/privacy | C | Config and source URL validation, redacted and bounded transport errors, author-free normalization, and evaluated/removed source-content purging are tested | Add retention-window and production secret-rotation checks |
| Deployment safety | D | Deterministic pull-request CI | Add preview environment, Workflow binding checks, and rollback runbook |

Update this table in the same change that materially changes a grade. Do not
raise a grade based only on a plan or untested implementation.
