# Quality score

Last verified: 2026-07-18

Grades describe evidence in the repository, not intended future behavior.

| Area | Grade | Evidence | Next gap |
| --- | --- | --- | --- |
| Product boundary | A | README and architecture define the post/reply-to-crowd-report boundary | Implement the paired site endpoint |
| Repository legibility | A- | Agent map, architecture map, indexed docs, execution-plan convention | Keep docs fresh as runtime slices appear |
| Static validation | B | Strict TypeScript, Biome, repository-doc validation, one-command check | Enforce module boundaries after modules exist |
| Unit testing | D | Placeholder Worker response test only | Add deterministic domain tests with each service |
| Integration testing | F | No D1 integration harness | Test repeated discovery, Workflow start, and pending delivery retry |
| Contract testing | F | Illustrative programmatic crowd-report request only | Add synthetic request and response fixtures with the site endpoint |
| Observability | D | Cloudflare logs enabled and required signals documented | Add structured, redacted event schema and local assertions |
| Security/privacy | C | Threat boundaries and data-minimization rules documented | Add secret/config validation and source-content purge tests |
| Deployment safety | D | Deterministic pull-request CI | Add preview environment, Workflow binding checks, and rollback runbook |

Update this table in the same change that materially changes a grade. Do not
raise a grade based only on a plan or untested implementation.
