# Reliability

Status: Target guarantees; not yet implemented

Last verified: 2026-07-17

## Guarantees

- Discovery and watch polling may repeat without duplicating source events.
- Source updates and outbox insertion are atomic.
- Delivery retries are bounded by exponential backoff and honor upstream hints.
- Per-event acknowledgement lets one invalid event avoid replaying an entire
  otherwise-successful batch forever.
- Overlapping Worker invocations do not double-claim the same due work.
- Deletions and removals are propagated and cannot be reversed by stale events.

## Failure handling

Reddit authentication failure, rate-limit exhaustion, malformed upstream data,
D1 contention, and site-ingest failures must be distinguishable in structured
logs without recording raw content or secrets. The scheduler should make the
next attempt explicit in durable state rather than depend on in-memory timers.

## Required signals

Track discovery freshness, due/overdue watches, poll outcomes, Reddit rate-limit
state, source lifecycle event counts, outbox depth and age, delivery attempts,
terminal errors, purge counts, and oldest retained-content age.

## Validation milestones

Before shadow traffic, add deterministic clock/transport fakes and D1-backed
tests for transaction rollback, retry, concurrent claiming, version ordering,
and retention. Before public use, define alert thresholds and exercise recovery
from expired credentials, a growing outbox, and a failed migration.
