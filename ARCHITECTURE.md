# Architecture

Status: Intended minimal runtime boundary

Last verified: 2026-07-31

## System context

`mrtdown-reddit-monitor` is a Cloudflare Worker that turns useful Reddit posts
and replies into structured crowd reports.

```text
Reddit
  -> this Worker: discover, store, parse, revisit, retry
  -> mrtdown-site: ingest a generic programmatic crowd report
  -> existing crowd-report moderation, clustering, and dispatch
```

The Worker owns all Reddit-specific state and interpretation. The site neither
stores conversations nor understands Reddit object shapes. The boundary is one
authenticated crowd report at a time.

## Current state

The repository has a placeholder HTTP entry point that returns `204`, test and
validation harnesses, validated contracts, the first D1 repository slice, and
bounded public-shadow RSS transports for search and selected conversations.
A discovery service accepts only validated search-feed identities, skips known
threads, resolves new identities through the selected post's RSS feed, verifies
the normalized root, and stores its source version in D1. A one-minute
scheduled handler wires that service to public-shadow transports through a
durable access policy. Every scheduled or Workflow RSS request reserves the
shared one-minute budget before its outbound fetch. The policy preserves a
longer `Retry-After` or quota-reset pause and disables shadow access after
terminal or repeated unsafe responses.
A conversation snapshot service stores the root and flat replies without
guessing parent relationships or treating feed absence as removal. Runtime
configuration, Reddit responses, semantic-parser decisions, site
requests/responses, and stored D1 rows are normalized at explicit boundaries.
Scheduled discovery applies the legacy crawler's broad rail filter and sends
only matching pending posts to a structured Workers AI parser. The parser is
grounded with the site's authenticated `v1` reference catalog, cached briefly
in D1, and rejects unknown entity IDs or invalid active memberships. Validated
decisions are stored once, report decisions receive a stable external report
ID, and parser or catalog failures leave the source pending for invocation retry.
Pending reports are submitted through a bounded authenticated site transport.
Accepted and idempotent responses are acknowledged durably; temporary failures
remain pending until any response-directed retry time, while validation,
authentication, and external-ID conflicts are retained as terminal categories
for inspection. Site retries still run when Reddit access is paused.
The migrations enforce version evaluation, delivery attempts, one-Workflow
identity with start and completion state, and Reddit access-state invariants. A
configured Cloudflare Workflow uses the durable thread identity, sleeps to the
fixed check times, then snapshots and evaluates only that thread before
delivery. Scheduler and Workflow logs include an aggregate-only D1 metrics
snapshot: freshness age, active Workflow count, evaluation counts, pending
delivery age, and normalized Reddit access state.

## Runtime slices

Keep the implementation small and directional:

```text
validated contracts -> D1 repository -> discovery/workflow services -> Worker entry points
```

- **Validated contracts** parse Reddit responses, configuration, parser
  results, the site reference catalog, and site responses.
- **D1 repository** stores discovered threads and versioned source objects
  together with parsing, delivery state, and one briefly cached site reference
  catalog. Raw source text is cleared after evaluation and purged across
  versions when Reddit reports removal.
- **Discovery service** persists the next community independently of elapsed
  time, searches it or hydrates one durable candidate identity per scheduled
  RSS opportunity, then evaluates new posts. Repeatedly missing candidates are
  quarantined without retaining source content.
- **Workflow service** reserves a deterministic Cloudflare instance ID for each
  selected thread, recovers an already-created instance after an ambiguous
  create response, and revisits that thread at the fixed polling schedule.
- **Delivery service** maps a parsed source object to the site's programmatic
  crowd-report request, records acknowledgement or a normalized failure, and
  honors response-directed retry timing without exposing upstream bodies.
- **Worker entry points** adapt scheduled discovery and Cloudflare Workflows,
  emitting aggregate-only metrics after each safe outcome.
  Scheduled discovery starts selected thread monitors after durable delivery;
  each Workflow snapshots, evaluates, and delivers only its own thread.
  Normalized Reddit pause and transport failures defer a Workflow check to the
  durable resume time rather than dropping it, while
  semantic inference, storage, and programming failures retry the durable step.

Reddit transport, parsing, time, and site transport should be injected so tests
remain deterministic. Add abstraction only where one of those boundaries needs
it; do not pre-build a generic event-processing framework.

## Durable invariants

- A discovered source object has a stable identity and content version.
- Content versions depend on normalized source meaning, not transport-only
  timestamps, permalinks, or unavailable RSS parent relationships.
- The same content version is not parsed repeatedly.
- A relevant thread starts at most one active Workflow.
- A parsed crowd report has one stable external report ID across retries.
- The source object is durably pending before delivery is attempted.
- Parsed line and station entity IDs match the cached active site catalog;
  site ingestion remains authoritative when the cache is briefly stale.
- Site acknowledgement is recorded only after an accepted or idempotent-success
  response.
- Raw source bodies and complete delivery payloads never enter logs or checked-in
  fixtures.
- An edited root post is versioned and re-evaluated like a changed reply;
  absence from an RSS snapshot is not evidence of deletion.
- Public-shadow RSS attempts are atomically limited to one shared request per
  minute. Search identities remain durable until their conversation feed is
  fetched or they become stale because the thread is already stored.
- A candidate receiving three permanent missing (`404` or `410`) conversation
  responses is quarantined so it cannot block later discovery. A selected
  thread receiving those statuses advances to its next fixed Workflow check.
- A hydrated root that fails its queued identity or subreddit boundary check is
  quarantined immediately instead of being retried indefinitely.

D1 uniqueness constraints and short transactions should enforce these rules.
Do not add claims, lifecycle events, support aggregation, generalized leases,
or a separate outbox unless measured failures show the simpler storage cannot
meet them.

## Change protocol

Architecture changes require an execution plan recording the boundary,
alternatives, rollback strategy, and validation. Update this document when the
implemented module graph changes.
