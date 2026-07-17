# Architecture

Status: Current scaffold and intended implementation boundary

Last verified: 2026-07-17

## System context

`mrtdown-reddit-monitor` is a Cloudflare Worker acquisition adapter. It observes
Reddit conversations and delivers versioned source events to `mrtdown-site`.
The site owns classification, moderation, confidence, and public presentation;
`mrtdown-data` owns accepted canonical evidence.

```text
Reddit Data API
  -> this Worker: discover, watch, version, retain briefly, retry delivery
  -> mrtdown-site: classify, moderate, correlate, publish community signals
  -> mrtdown-data: store accepted canonical evidence and impact
```

## Current state

The repository currently has one Worker entry point that returns `204`. There
are no Reddit calls, scheduled handlers, D1 bindings, migrations, or delivery
routes yet. The gap is intentional: documents describing the target must not be
mistaken for implemented behavior.

## Intended runtime slices

Code should grow into explicit slices with one-way dependencies:

```text
contracts -> configuration -> repositories -> services -> runtime entry points
```

- **Contracts** parse Reddit, configuration, database, and site-ingest shapes.
- **Configuration** turns validated bindings into explicit runtime policy.
- **Repositories** own D1 queries and transaction boundaries.
- **Services** implement discovery, diffing, scheduling, retention, and outbox
  delivery without depending on Worker request/event objects.
- **Runtime entry points** adapt scheduled and HTTP events and wire providers.

Cross-cutting capabilities such as time, hashing, logging, Reddit transport,
and site transport should enter services through explicit interfaces. Domain
logic must not import Wrangler or construct production clients directly.

When multiple slices exist, add a structural test or import-boundary lint before
relying on this dependency direction as an architectural guarantee.

## Durable state invariants

- A source-object change and its outbox event are one D1 transaction.
- Event IDs and content versions are deterministic.
- Delivery is at-least-once, so the consumer contract must be idempotent.
- Version ordering prevents delayed events from reversing deletion or edits.
- Work claiming is safe under overlapping scheduled invocations.
- Raw content expiry does not remove the minimal tombstone required to prevent
  replay or resurrection.

## Change protocol

Architecture changes require an execution plan that records the affected
boundary, alternatives, migration/rollback strategy, and new mechanical
enforcement. Update this file when the implemented module graph changes.
