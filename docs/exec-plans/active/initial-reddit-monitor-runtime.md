# Initial Reddit Monitor Runtime

Status: Active
Started: 2026-07-18

## Goal and acceptance criteria

Build the smallest Worker that can discover relevant posts in `r/singapore`
and `r/askSingapore`, submit them as structured programmatic crowd reports,
and revisit selected threads for useful reply updates.

The first release is complete when:

- repeated discovery creates one stored source object and one Workflow per
  relevant thread;
- a relevant post is parsed and acknowledged by the site's authenticated
  programmatic crowd-report endpoint;
- the Workflow checks replies at the agreed fixed schedule;
- each useful new reply becomes one independently idempotent crowd report;
- temporary delivery failure is retried without duplicate site reports;
- shadow results cover new relevant posts at least as well as the existing
  crawler; and
- `npm run check` passes without live external calls.

## Context and constraints

The existing crawler's five-minute Reddit RSS search has operated reliably for
more than a year. Preserve it until shadow comparison proves the replacement.
The monitor is separate because frequent mostly-empty discovery is a good fit
for Cloudflare scheduling, while the Fly-hosted site may scale to zero.

The site owns `POST /internal/api/crowd-reports` and the crowd-report domain.
This Worker owns Reddit transport, source storage, relevance parsing, reply
Workflows, and delivery retry. It sends structured report fields, an opaque
external report ID, and an optional permalink; it never sends raw conversation
trees or author identities.

Expected volume is small: a July 2026 sample found about 2.65 broad rail-query
candidates per day and roughly one to three live operational threads per month.
Use D1 and Cloudflare Workflows directly. Queues, general lease machinery,
claims, source-event streams, and a separate delivery outbox are out of scope.

OAuth is the intended production Reddit transport. Public RSS plus bounded
thread JSON may be used only as explicit shadow transport while approval is
pending and only after a deployed Cloudflare canary succeeds.

## Plan

1. Define validated configuration, Reddit response, parser result, and site
   response boundaries using synthetic fixtures.
2. Add the minimum D1 migration for discovered threads/source objects,
   content-version evaluation, Workflow identity, parsed report data, and
   delivery status.
3. Implement RSS or OAuth discovery behind a narrow transport interface and a
   five-minute scheduled handler.
4. Implement deterministic candidate filters and the semantic parser that
   produces the site's existing structured crowd-report fields.
5. Implement single-report delivery with stable external IDs and durable
   acknowledgement/retry state.
6. Implement one Workflow per relevant thread with checks near `+10m`, `+25m`,
   `+40m`, `+55m`, `+3h`, `+6h`, and `+24h`.
7. At each check, store and evaluate new or changed replies; deliver only
   material service updates as new reports.
8. Add safe structured metrics for discovery freshness, active Workflows,
   parsing outcomes, and pending delivery age.
9. Run shadow comparison with the crawler, tune relevance and cadence only
   from observed misses, and document cutover evidence.

## Progress

- 2026-07-18: Reset implementation history to the completed repository harness
  after rejecting the source-event, claim, lifecycle, and generalized leasing
  design as unnecessary for the measured workload.
- 2026-07-18: Replaced the monitor boundary with direct programmatic crowd
  reports and a fixed per-thread Workflow schedule.
- 2026-07-18: Implemented the first runtime slice: validated configuration,
  parser decisions, site delivery requests and acknowledgements, and bounded
  public Reddit conversation JSON. Added synthetic boundary fixtures and 12
  deterministic tests without adding a runtime dependency.

## Decisions

- One useful Reddit post or reply maps to one crowd report.
- Resolution is another report with `isStillHappening: false`; the monitor does
  not maintain a claim lifecycle.
- Delivery idempotency uses the site's producer-scoped `externalReportId`.
- Delivery state lives beside the source object; there is no separate outbox in
  the initial design.
- D1 uniqueness and Cloudflare Workflow guarantees are preferred over a
  general leasing system.
- The runtime Zod schema in the site is authoritative; defer OpenAPI generation
  until demonstrated need.
- Preserve the proven crawler until shadow coverage and one complete 24-hour
  Workflow have been observed.
- Boundary errors contain stable categories rather than untrusted values, and
  normalized Reddit source objects never expose author identity.
- Site acknowledgement parsing requires only the planned report ID and
  moderation status so additive response metadata remains compatible.

## Validation

Run `npm run check` after every implementation slice. Tests must use synthetic
Reddit-shaped fixtures and fake transports, parsers, clocks, and site responses.
No deterministic validation command may call Reddit or the deployed site.

Before cutover, record shadow discovery comparison, reply usefulness, parser
false positives/negatives, delivery retry behavior, and a complete Workflow
timeline here.

Implementation validation:

- 2026-07-18: `npm run check` passed with 4 test files and 13 tests after the
  validated-contract slice.

## Follow-ups

- Selectively recover or reimplement the bounded public JSON parser and
  transport from the preserved `backup` tag if it still matches the minimal
  source-object model.
- Remove Reddit from `mrtdown-data-crawler` in a separate change after the
  rollback window.
- Consider generated contract artifacts, Queues, longer watches, or author
  correlation only if real operation demonstrates the need.
