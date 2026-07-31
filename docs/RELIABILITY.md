# Reliability

Status: Scheduled discovery, post selection, durable site delivery, and safe runtime metrics implemented

Last verified: 2026-07-31

## Guarantees

- Repeated discovery does not create duplicate source objects, reports, or
  Workflows.
- Selected posts and replies are stored before delivery is attempted.
- Stable external report IDs make site delivery idempotent.
- A failed delivery remains visibly pending and can be retried by the next
  eligible scheduled or Workflow invocation. `Retry-After` timing gates early
  retries, and terminal request, authentication, or idempotency failures are
  excluded from automatic retries until inspected.
- Pending site delivery still runs while Reddit access is paused or stopped.
- Workflow steps may repeat without resubmitting acknowledged reports.
- An edited root post creates a new pending source version, so author-added
  rectifications can be evaluated as resolution reports.
- A reply missing from a later RSS snapshot remains stored; only an explicit
  removed or deleted body triggers content purging.
- Reddit backoff and `Retry-After` take precedence over the nominal schedule.
- All public-shadow RSS calls share one D1-backed atomic request reservation per
  minute. Search candidates remain queued until a later minute can fetch their
  authoritative conversation feed, and paused or transient Workflow checks
  wait and retry at the recorded resume time.
- Scheduled subreddit rotation is durable and advances only after a successful
  search, so deferred hydration does not bias coverage. A candidate with three
  permanent missing responses is quarantined; `404` and `410` thread checks do
  not retry within a Workflow step.
- Semantic inference or output-validation failure leaves source evaluation
  pending so a later invocation can retry without changing its content version.
- The site's current reference catalog is cached in D1 for its advertised
  lifetime. A retryable catalog outage may use a cache no more than 24 hours
  old; authentication or invalid-contract failures never use stale data.

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

Started and completed Workflow timestamps make the active-Workflow metric
durable without treating completed monitors as active.

## Required signals

Structured scheduler and Workflow events now include discovery freshness, active
Workflow count, durable parser-outcome counts, pending delivery count and age,
and normalized Reddit rate-limit state. Invocation outcomes include candidate,
poll, and site-response-category counts.

## Validation milestones

D1-backed tests now cover discovery replay, candidate/conversation identity
verification, flat conversation snapshot replay, edited root posts, RSS absence
semantics, repeated storage, one-Workflow-identity behavior, source-version
deduplication, durable pending delivery, quota exhaustion, repeated rate limits,
one-minute atomic RSS reservations, persistent subreddit rotation, deferred
candidate hydration/quarantine, Workflow retry after a paused check, permanent
missing-thread progression, sustained malformed responses, scheduled backoff replay, cheap-filter
rejection, validated semantic selection, inference retry, site retry timing,
catalog refresh and stale fallback, terminal delivery state, acknowledgement,
and local Workflow completion across every fixed schedule step. Before shadow traffic, run the
deployed public-shadow canary, exercise producer credential failure, and sample semantic false
positives and negatives. Before cutover, exercise credential failure, a failed
Workflow step, and a temporary site outage.
