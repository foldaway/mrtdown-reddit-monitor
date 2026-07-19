# Architecture

Status: Intended minimal runtime boundary

Last verified: 2026-07-18

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
the normalized root, and stores its source version in D1. A five-minute
scheduled handler wires that service to public-shadow transports through a
durable access policy. The policy pauses requests until `Retry-After` or quota
reset, and disables shadow access after terminal or repeated unsafe responses.
A conversation snapshot service stores the root and flat replies without
guessing parent relationships or treating feed absence as removal. Runtime
configuration, Reddit responses, semantic-parser decisions, site
requests/responses, and stored D1 rows are normalized at explicit boundaries.
Scheduled discovery applies the legacy crawler's broad rail filter and sends
only matching pending posts to a structured Workers AI parser. Validated
decisions are stored once, report decisions receive a stable external report
ID, and parser failures leave the source pending for invocation retry.
The migrations enforce version evaluation, delivery, one-Workflow-identity,
and Reddit access-state invariants. Conversation snapshots are not yet wired to
a Workflow; there are no Workflow bindings or delivery calls yet.

## Runtime slices

Keep the implementation small and directional:

```text
validated contracts -> D1 repository -> discovery/workflow services -> Worker entry points
```

- **Validated contracts** parse Reddit responses, configuration, parser
  results, and site responses.
- **D1 repository** stores discovered threads and versioned source objects
  together with parsing and delivery state. Raw source text is cleared after
  evaluation and purged across versions when Reddit reports removal.
- **Discovery service** finds and evaluates new candidate posts.
- **Workflow service** revisits one selected thread at the fixed polling
  schedule and evaluates new replies.
- **Delivery service** maps a parsed source object to the site's programmatic
  crowd-report request and records acknowledgement.
- **Worker entry points** adapt scheduled events and, later, Cloudflare
  Workflows. Scheduled discovery currently catches normalized Reddit transport
  failures after their pause/stop state is durable; semantic inference, storage,
  and programming failures still fail the invocation so pending evaluation can
  retry.

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
- Site acknowledgement is recorded only after an accepted or idempotent-success
  response.
- Raw source bodies and complete delivery payloads never enter logs or checked-in
  fixtures.
- An edited root post is versioned and re-evaluated like a changed reply;
  absence from an RSS snapshot is not evidence of deletion.

D1 uniqueness constraints and short transactions should enforce these rules.
Do not add claims, lifecycle events, support aggregation, generalized leases,
or a separate outbox unless measured failures show the simpler storage cannot
meet them.

## Change protocol

Architecture changes require an execution plan recording the boundary,
alternatives, rollback strategy, and validation. Update this document when the
implemented module graph changes.
