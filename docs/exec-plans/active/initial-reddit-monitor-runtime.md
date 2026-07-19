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
- parsed line and station identifiers are grounded in the site's active
  producer reference catalog before becoming deliverable;
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

OAuth is the intended production Reddit transport. Bounded public RSS search
and selected-post feeds may be used only as explicit shadow transport while
approval is pending and only after a deployed Cloudflare canary succeeds.

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
5. Consume and briefly cache the site's producer reference catalog; ground and
   validate semantic parser identifiers against active memberships.
6. Implement single-report delivery with stable external IDs and durable
   acknowledgement/retry state.
7. Implement one Workflow per relevant thread with checks near `+10m`, `+25m`,
   `+40m`, `+55m`, `+3h`, `+6h`, and `+24h`.
8. At each check, store and evaluate new or changed replies; deliver only
   material service updates as new reports.
9. Add safe structured metrics for discovery freshness, active Workflows,
   parsing outcomes, and pending delivery age.
10. Run shadow comparison with the crawler, tune relevance and cadence only
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
- 2026-07-18: Added the initial D1 migration and repository. D1 uniqueness and
  checks now enforce source-version evaluation, durable pending delivery, and
  one Workflow identity per selected thread. Added deterministic content and
  report IDs plus D1-backed tests for replay, edits, removal purge, pending
  retry state, and acknowledgement.
- 2026-07-18: Reimplemented the bounded public-shadow conversation transport
  against the simplified source-object contract. It uses one Reddit origin,
  conditional validators, response byte limits, safe response metadata, and
  explicit authentication, block, rate-limit, content-type, and shape errors.
  The transport remains unwired until discovery and Workflow services land.
- 2026-07-18: Added bounded public-shadow search discovery while preserving the
  legacy crawler's subreddit search shape. Atom feeds contribute only validated
  thread identities and permalinks; new identities are resolved through public
  conversation JSON, checked against the candidate, and stored in D1. Repeated
  discovery skips the conversation fetch for an existing thread.
- 2026-07-19: Replaced unauthenticated conversation JSON in public-shadow mode
  with the selected post's bounded RSS feed after Reddit announced the JSON
  path's deprecation. Conversation normalization extracts the root and flat
  replies without author identity or guessed nesting. Snapshot persistence now
  stores all observed versions, replays idempotently, preserves replies absent
  from later feeds, and creates a new pending version when the root post is
  edited with rectification information.
- 2026-07-19: Wired public-shadow discovery to a five-minute scheduled handler.
  A D1-backed access policy checks before every Reddit request, persists
  `Retry-After` and exhausted-quota pauses, and stops shadow access on terminal
  or repeated unsafe responses. Scheduled logs contain normalized outcomes and
  counts only; D1 and configuration failures still fail the invocation.
- 2026-07-19: Declared scheduled runtime variables and required secret names in
  `wrangler.jsonc`, regenerated the Worker `Env` interface, and removed the
  manually maintained scheduled-environment type.
- 2026-07-19: Added legacy-compatible broad rail filtering and a structured
  Workers AI semantic parser. Scheduled discovery now evaluates pending posts,
  stores irrelevant or report decisions once, assigns stable report IDs, and
  leaves inference failures pending for retry. The site acknowledgement
  boundary now matches the paired endpoint's authoritative response shape.
- 2026-07-19: Co-located all module test files with their primary source
  modules. Shared synthetic Reddit fixtures remain under `test/fixtures` so
  contracts, services, and runtime tests reuse one author-free fixture set.
- 2026-07-19: Implemented authenticated single-report delivery to the site's
  authoritative `202` endpoint. The bounded transport validates accepted
  responses without retaining upstream bodies, D1 records stable retries,
  response-directed retry timing, terminal failure categories, and durable
  acknowledgements, and scheduled delivery continues during Reddit backoff.
- 2026-07-19: Integrated the site's authenticated `v1` producer reference
  catalog. A bounded transport and D1 cache honor its five-minute cache policy,
  allow a retryable outage to use at most 24-hour stale data, and keep terminal
  authentication or contract failures visible. Workers AI receives the catalog
  separately from untrusted Reddit text and can persist only active site entity
  IDs with valid station-to-line memberships.
- 2026-07-20: Adopted pinned Zod 4 validation for the nested producer reference
  catalog while preserving the monitor's stable, redacted boundary-error
  categories. Older bounded Reddit parsers remain explicit because their byte,
  XML, and transport constraints are not schema-validation concerns.

## Decisions

- One useful Reddit post or reply maps to one crowd report.
- Resolution is another report with `isStillHappening: false`; the monitor does
  not maintain a claim lifecycle.
- Delivery idempotency uses the site's producer-scoped `externalReportId`.
- Delivery state lives beside the source object; there is no separate outbox in
  the initial design.
- D1 uniqueness and Cloudflare Workflow guarantees are preferred over a
  general leasing system.
- The runtime Zod schema in the site is authoritative. The monitor keeps a
  consumer-owned Zod schema for the versioned wire contract rather than sharing
  runtime source across repositories; defer generated artifacts until observed
  drift justifies them.
- Preserve the proven crawler until shadow coverage and one complete 24-hour
  Workflow have been observed.
- Boundary errors contain stable categories rather than untrusted values, and
  normalized Reddit source objects never expose author identity.
- Site acknowledgement parsing consumes the authoritative endpoint envelope
  and normalizes its report ID and status while allowing additive metadata.
- The cheap post filter preserves the legacy crawler's word and phrase matches;
  semantic inference makes the narrower operational-relevance decision.
- Semantic inference uses the Workers AI Llama 3.3 70B fast model with JSON
  Schema output. Source text appears only in the untrusted user message, and
  every result passes the local parser-decision boundary before persistence.
- Deterministic tests use a separate Wrangler config without the AI binding so
  validation cannot invoke remote or billable inference.
- Source content versions and external report IDs use domain-separated SHA-256
  identities over normalized source meaning. Parent relationships, permalinks,
  and timestamps are excluded so RSS/OAuth transport changes do not alter
  stored identity.
- Source title/body text is cleared after evaluation. A removed or deleted
  version purges retained text for every stored version of that object.
- Late, previously unseen active versions are stored as superseded rather than
  replacing the deterministic current version.
- Public-shadow conversation access has one allowed origin and no automatic
  fallback. It returns only bounded cache/rate-limit metadata and normalized
  source objects; response bodies never enter transport errors.
- Public-shadow Atom parsing uses a pinned XML parser because the Workers
  runtime does not provide a general XML DOM. The boundary rejects document
  types, limits feed bytes, nesting, entity expansion, and entries. Search feeds
  contribute candidate identity only; selected-post feeds contribute only text
  inside Reddit's rendered `div.md` content.
- Public-shadow conversation RSS is fetched without `depth` or `context`.
  Replies are stored flat with no parent ID, and context-dependent replies may
  be rejected later by the semantic parser rather than reconstructed through
  extra Reddit requests.
- Every conversation snapshot includes the root post. Root content edits are
  versioned and re-evaluated because authors may add a rectification; an object
  absent from a later feed is not considered removed.
- Public-shadow access stops immediately on `401`, `403`, or an unexpected
  content type; two consecutive `429` responses or three consecutive malformed
  or oversized shapes also stop access. A successful response resets the
  consecutive-failure counters. Disabled state requires deliberate operator
  inspection and reset rather than automatic recovery.
- A successful response reporting zero remaining quota pauses additional
  requests in the same invocation until its reset timestamp, or for five
  minutes when Reddit omits the reset. A `429` without usable backoff metadata
  pauses for fifteen minutes.
- Site delivery follows the endpoint's `202` success contract. Network,
  throttling, server, and invalid accepted-response failures remain retryable;
  invalid requests, authentication failures, idempotency conflicts, and
  unexpected statuses are terminal until operator inspection. Redirects are
  not followed so the bearer credential cannot be forwarded to another URL.
- The site's deployed database remains authoritative for reference validity.
  The monitor consumes the same-origin producer catalog as a briefly cached
  parser-grounding and pre-delivery validation aid; it does not call
  `mrtdown-data` directly. Public station codes are lookup hints, while
  `stationIds` always contain catalog entity IDs.
- Direct `mrtdown-data` manifest consumption was rejected because hashes and
  entity IDs do not encode the site's imported-state lag, active membership
  checks, or code-to-entity mapping. If the catalog integration must be rolled
  back, remove the provider from semantic parsing and the catalog URL binding;
  the additive D1 cache table can remain unused while site ingestion continues
  enforcing references authoritatively.

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
- 2026-07-18: `npm run check` passed with 5 test files and 18 tests after the
  D1 storage slice, including formatting, lint, types, tests, and documentation
  validation.
- 2026-07-18: `npm run check` passed with 6 test files and 25 tests after the
  bounded public-shadow transport slice, including formatting, lint, types,
  tests, and documentation validation.
- 2026-07-18: `npm run check` passed with 8 test files and 32 tests after the
  public-shadow search discovery slice, including Atom limits and identity
  validation, safe transport failures, discovery replay, and D1 persistence.
- 2026-07-19: `npm run check` passed with 10 test files and 38 tests after the
  public-shadow conversation RSS slice, including flat source normalization,
  bounded transport behavior, parentless reply storage, snapshot replay and
  absence semantics, transport-neutral identity, and root-post rectification
  versions.
- 2026-07-19: `npm run check` passed with 12 test files and 46 tests after the
  scheduled discovery slice, including D1-backed quota pauses, repeated-rate
  and shape-failure stops, runtime replay, safe structured outcomes, and
  generated Cloudflare types.
- 2026-07-19: `npm run check` passed with 15 test files and 55 tests after the
  post-selection slice, including legacy-compatible filtering, structured
  semantic output, prompt/source separation, D1-backed evaluation retry,
  authoritative site acknowledgement parsing, and scheduled selection.
- 2026-07-19: `npm run check` passed with 17 test files and 67 tests after the
  delivery slice, including authenticated request construction, bounded
  response handling, normalized HTTP failures, D1-backed retry and terminal
  state, stable replay IDs, acknowledgement, and delivery during Reddit
  backoff.
- 2026-07-19: `npm run check` passed with 22 test files and 85 tests after the
  producer-reference-catalog slice, including schema integrity, authenticated
  bounded fetches, D1 caching and stale fallback, entity-ID grounding, active
  membership validation, same-origin configuration, and scheduled integration.
- 2026-07-20: `npm run check` passed with 22 test files and 88 tests after the
  first Zod migration slice. A Wrangler deployment dry run produced a 145.52
  KiB gzip upload, and the catalog retained normalized outputs, stable error
  categories, strict keys, bounds, and cross-record integrity checks.

## Follow-ups

- Deploy a public-shadow canary and verify the scheduled handler from the
  Cloudflare runtime before enabling sustained shadow traffic.
- Remove Reddit from `mrtdown-data-crawler` in a separate change after the
  rollback window.
- Consider generated contract artifacts, Queues, longer watches, or author
  correlation only if real operation demonstrates the need.
