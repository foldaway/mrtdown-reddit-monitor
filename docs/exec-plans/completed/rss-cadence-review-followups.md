# RSS cadence review follow-ups

Status: Completed
Started: 2026-07-31
Completed: 2026-07-31

## Goal and acceptance criteria

Address the unresolved PR review feedback for public-shadow RSS cadence. Discovery must rotate configured subreddits independently of wall-clock time, one permanently unavailable candidate must not block later work, and a Workflow must not retry a permanently missing RSS endpoint indefinitely.

## Context and constraints

The shared one-minute RSS reservation and deferred candidate queue are implemented on `codex/rss-cadence`. The queue previously selected a subreddit from the current minute and left unexpected-status candidates at the queue head. Workflow retry treated every transport error as retryable.

Keep RSS as the transport, retain bounded retention of candidate identities only, and preserve retries for genuinely transient failures. Do not reply to or resolve GitHub review threads unless separately requested.

## Plan

1. Persist scheduled discovery's next-subreddit cursor and advance it only after a successful search feed fetch.
2. Track bounded hydration failures for deferred candidates, rotate failures behind healthy work, and quarantine candidates after repeated permanent missing statuses.
3. Surface upstream status on normalized thread-check transport errors and avoid retrying permanent missing statuses in a Workflow.
4. Add deterministic D1 and Workflow coverage, update operational documentation, run `npm run check`, then update this plan and move it to completed.

## Progress

- 2026-07-31: Read the three unresolved review threads on PR #2 and accepted all of them for implementation.
- 2026-07-31: Added a D1-backed next-subreddit cursor. It advances after a successful search fetch, so queued hydration and other RSS work cannot bias community coverage.
- 2026-07-31: Added failure-aware candidate ordering and quarantine after three permanent (`404` or `410`) conversation-feed failures. A failed candidate moves behind healthy queued candidates before it is retried.
- 2026-07-31: Added the normalized upstream status to Workflow transport outcomes. `404` and `410` no longer cause an in-step retry loop; the Workflow advances to its next scheduled check.
- 2026-07-31: Follow-up review found that an authoritative root/subreddit mismatch could still leave a candidate at the queue head. Such candidates now quarantine immediately after the boundary check fails.
- 2026-07-31: Follow-up review found that re-seen quarantined candidates could inflate queued-work metrics. Candidate enqueue now reports whether it created a new pending row, and only that outcome increments the metric.

## Decisions

- Advance the durable subreddit cursor after a successful search rather than before it, so a temporary search failure retries the same community.
- Treat only `404` and `410` as permanent missing conversation statuses. Other unexpected statuses retain the existing transient retry behavior.
- Quarantine after three permanent failures, retaining identity-only operational state without storing Reddit source content.
- A root/subreddit identity mismatch is terminal for that candidate because the authoritative feed contradicts the validated search identity; quarantine it immediately.
- Re-seen pending or quarantined identities are not new queued work; metrics count only a newly inserted pending candidate.

## Validation

- 2026-07-31: `npm run check` passed after the identity-mismatch quarantine
  follow-up: formatting, linting, type checks, 27 deterministic test files /
  100 tests, and documentation validation.
- 2026-07-31: `npm run check` passed after the queued-candidate metric
  follow-up: formatting, linting, type checks, 27 deterministic test files /
  101 tests, and documentation validation.
- 2026-07-31: `git diff --check` passed.

## Follow-ups

- Push the identity-mismatch follow-up to PR #2. Do not resolve its review thread until explicitly requested.
