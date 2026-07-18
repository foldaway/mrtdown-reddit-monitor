# Quality score

Last verified: 2026-07-18

Grades describe evidence in the repository, not intended future behavior.

| Area | Grade | Evidence | Next gap |
| --- | --- | --- | --- |
| Product boundary | A | README and architecture define the post/reply-to-crowd-report boundary | Implement the paired site endpoint |
| Repository legibility | A- | Agent map, architecture map, indexed docs, execution-plan convention | Keep docs fresh as runtime slices appear |
| Static validation | B | Strict TypeScript, Biome, repository-doc validation, one-command check | Enforce module boundaries after modules exist |
| Unit testing | C | Deterministic tests cover runtime config, parser output, bounded RSS search/conversation normalization, transport failure modes, transport-neutral source identities, and site requests/responses | Add deterministic service tests with each parsing, delivery, and Workflow slice |
| Integration testing | C | D1-backed tests cover scheduled discovery replay, durable rate-limit pauses and stop policy, identity verification, flat snapshot replay, root-post edits, absence semantics, version evaluation, one Workflow identity, pending delivery, acknowledgement, and content purge | Add semantic parsing, delivery, and Workflow service integration tests |
| Contract testing | D | Synthetic consumer tests enforce the planned site request and acknowledgement shapes | Reconcile tests with the site's authoritative schema when its endpoint lands |
| Observability | D | Scheduled discovery emits redacted outcome/count records with a local content-leak assertion | Add a shared structured event schema and parsing, delivery, and Workflow signals |
| Security/privacy | C | Config, Atom candidate/content, and source URL validation; redacted and bounded transport errors; author-free flat normalization; and evaluated/removed source-content purging are tested | Add retention-window and production secret-rotation checks |
| Deployment safety | D | Deterministic pull-request CI, explicit five-minute cron, and durable public-shadow stop state | Add preview environment, Workflow binding checks, and rollback runbook |

Update this table in the same change that materially changes a grade. Do not
raise a grade based only on a plan or untested implementation.
