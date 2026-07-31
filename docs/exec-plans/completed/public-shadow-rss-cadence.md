# Public-shadow RSS one-minute cadence

Status: Completed
Started: 2026-07-31
Completed: 2026-07-31

## Goal and acceptance criteria

Keep the public-shadow RSS transport operational under Reddit's one-request-per-minute limit without adding OAuth work. Every RSS request from scheduled discovery or a thread Workflow must share one durable, atomic request reservation. Scheduled discovery must not issue a second RSS request after using that reservation, and the configured schedule must provide one opportunity per minute.

## Context and constraints

The public-shadow transport is a temporary RSS-only boundary. Its access state previously recorded response-directed backoff only after the outbound fetch began. A scheduled discovery could perform one search request per configured subreddit and resolve candidates through another RSS request, while Workflows also fetched conversation RSS feeds. This violated the observed shared one-request-per-minute limit.

No raw Reddit content, alternate hosts, proxies, browser sessions, or OAuth changes are in scope. Existing `Retry-After`, quota-reset, and terminal-stop behavior remains authoritative when it requires a longer pause.

## Plan

1. Add a D1-backed atomic reservation that marks an RSS request before the outbound fetch and preserves the later of the cadence and response-directed pauses.
2. Make the public-shadow policy reserve before every discovery or conversation request and return the existing normalized paused outcome when the reservation is unavailable.
3. Reshape the scheduled discovery unit of work so it consumes at most one RSS reservation, retaining unprocessed candidate identities durably for later hydration if needed.
4. Change the scheduled trigger to one minute, retain safe aggregate metrics, and document the durable cadence guarantee.
5. Add deterministic D1-backed coverage for sequential and concurrent reservations, scheduled candidate continuation, response backoff precedence, and Workflow sharing; run `npm run check`.

## Progress

- 2026-07-31: Inspected the public-shadow transports, durable access policy, scheduled discovery, thread Workflow, migrations, and reliability documentation. Confirmed that the previous policy recorded access only after a request and therefore could not enforce the observed global cadence.
- 2026-07-31: Added atomic D1 reservation before outbound RSS fetches. The existing `blocked_until` state now preserves whichever is later: the one-minute cadence or Reddit's response-directed pause.
- 2026-07-31: Added a durable identity-only discovery-candidate queue. Each scheduled invocation performs one search or hydrates one queued candidate; it no longer makes a search request and conversation request in the same minute.
- 2026-07-31: Changed the scheduled trigger to once per minute. Workflow checks now sleep and retry after a cadence, backoff, or transient RSS pause, unless public-shadow access is deliberately disabled.

## Decisions

- Treat the one-minute limit as shared by every public Reddit RSS request, not separately by feed URL, subreddit, scheduled invocation, or Workflow.
- Preserve RSS mode and the existing validated candidate-to-conversation boundary; do not substitute search-feed content for the authoritative conversation feed.
- Persist only validated candidate identities and subreddit names while waiting to hydrate. Do not retain search-feed source text or URLs.
- A terminal public-shadow disable remains an operator-visible stop condition. It is not retried automatically because the existing safety policy requires deliberate inspection.

## Validation

- 2026-07-31: `npm run format`, `npm run typecheck`, and `npm test` passed. The deterministic suite ran 26 files and 94 tests, including atomic concurrent reservation, deferred candidate hydration after a pause, and Workflow retry after a paused check.
- 2026-07-31: `git diff --check` passed.

## Follow-ups

- Verify a deployed public-shadow canary after rollout, including the actual Reddit response headers and observed request cadence.
