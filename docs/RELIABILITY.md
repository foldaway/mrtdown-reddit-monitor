# Reliability

Status: Discovery storage path implemented; runtime handlers pending

Last verified: 2026-07-18

## Guarantees

- Repeated discovery does not create duplicate source objects, reports, or
  Workflows.
- Selected posts and replies are stored before delivery is attempted.
- Stable external report IDs make site delivery idempotent.
- A failed delivery remains visibly pending and can be retried by the next
  scheduled or Workflow invocation.
- Workflow steps may repeat without resubmitting acknowledged reports.
- An edited root post creates a new pending source version, so author-added
  rectifications can be evaluated as resolution reports.
- A reply missing from a later RSS snapshot remains stored; only an explicit
  removed or deleted body triggers content purging.
- Reddit backoff and `Retry-After` take precedence over the nominal schedule.

Use D1 uniqueness constraints and short transactions first. Do not introduce a
general lease manager, event stream, or transactional outbox unless overlapping
invocations cause a measured correctness problem that simpler constraints
cannot solve.

## Failure handling

Distinguish Reddit authentication, throttling, malformed upstream data, parser
failure, D1 failure, site authentication, site validation, and temporary site
failure in structured logs. Never include source bodies, credentials, or full
delivery payloads.

Malformed reports and conflicting external IDs are terminal until inspected.
Network failures, throttling, and server errors remain pending for bounded
retry. A Workflow should record its current step so Cloudflare retry does not
lose or duplicate work.

## Required signals

Track discovery freshness and candidate counts, active Workflow counts, poll
outcomes, parsed relevant posts and replies, pending delivery count and age,
site response categories, and Reddit rate-limit state.

## Validation milestones

D1-backed tests now cover discovery replay, candidate/conversation identity
verification, flat conversation snapshot replay, edited root posts, RSS absence
semantics, repeated storage, one-Workflow-identity behavior, source-version
deduplication, and durable pending delivery. Before shadow traffic, add the
semantic parser, scheduled runtime wiring, and service-level retry tests.
Before cutover, exercise credential failure, rate limiting, a failed Workflow
step, and a temporary site outage.
