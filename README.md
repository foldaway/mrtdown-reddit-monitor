# mrtdown-reddit-monitor

Reddit post and reply monitoring for MRTDown crowd reports.

> The repository currently contains a Cloudflare Worker scaffold, validated
> boundary contracts, the initial D1 repository, and bounded public-shadow
> RSS search/conversation transports with D1-backed discovery and conversation
> snapshot services. Scheduled
> runtime wiring, Cloudflare Workflows, semantic parsing, and delivery calls are
> not yet implemented.

## Repository Guide

- [Agent guide](AGENTS.md) maps commands and invariants.
- [Architecture](ARCHITECTURE.md) records the system boundary.
- [Active execution plan](docs/exec-plans/active/initial-reddit-monitor-runtime.md)
  sequences the first implementation.
- [Repository knowledge map](docs/README.md) indexes quality, reliability, and
  security documents.

Install dependencies with `npm ci`, run the Worker with `npm run dev`, and run
the deterministic validation suite with `npm run check`.

## Purpose

`mrtdown-data-crawler` has reliably discovered Reddit posts through RSS for
more than a year, but it sees each thread only once. This Worker will retain
that discovery capability and revisit relevant threads for useful replies.

```text
Reddit
  -> mrtdown-reddit-monitor
     discover, select, store, parse, revisit, retry
  -> POST mrtdown-site/internal/api/crowd-reports
  -> existing MRTDown crowd-report pipeline
```

The monitor owns everything Reddit-specific. `mrtdown-site` receives only
ordinary structured crowd reports through a generic authenticated endpoint.
A relevant post becomes one report; a later reply containing a meaningful
service update becomes another. A resolution reply is represented by a report
with `isStillHappening: false` rather than a separate claim lifecycle.

The paired site plan is:

- `../mrtdown-site/docs/plans/active/reddit-community-monitoring.md`

## Responsibilities

- Periodically search `r/singapore` and `r/askSingapore` for potentially
  relevant new posts.
- Decide whether a candidate post describes a live Singapore rail condition.
- Store selected posts and their delivery state in D1.
- Parse useful source text into MRTDown's structured crowd-report fields.
- Start one Cloudflare Workflow for each selected thread.
- Revisit the thread at a small fixed schedule and inspect new or changed
  replies.
- Submit only replies that materially update the reported effect, location,
  delay, direction, or whether the condition is still happening.
- Retry unacknowledged reports with a stable external report ID.
- Respect Reddit authentication, rate limits, backoff, and removal behavior.

## Non-Responsibilities

- Do not implement a claim, observation-event, support-aggregation, or
  community-signal subsystem.
- Do not send raw conversations, Reddit object hierarchies, or usernames to
  `mrtdown-site`.
- Do not call `mrtdown-data` directly.
- Do not decide how the site clusters, moderates, displays, or dispatches crowd
  reports.
- Do not treat every reply as a report; commentary, jokes, speculation, and
  repeated statements are ignored.
- Do not introduce Cloudflare Queues, a generic scheduler, or a separate
  delivery-outbox table without measured need.
- Do not evade Reddit blocks with alternate hosts, rotating addresses,
  proxies, or browser cookies.

## Runtime Flow

### Discovery

Run discovery every five minutes initially. Search both configured subreddits
with a broad rail query, then apply cheap keyword filters and a semantic
relevance parser. Repeated discovery of the same post must not create another
record, report, or Workflow.

The existing crawler's RSS search is the proven discovery baseline. Keep it in
place until this monitor demonstrates equivalent coverage.

### Initial report

For a relevant post:

1. Normalize and store the post in D1.
2. Parse it into structured crowd-report fields.
3. Assign a stable opaque `externalReportId`.
4. Submit it to the site's programmatic crowd-report endpoint.
5. Record the acknowledgement or retryable error alongside the stored post.
6. Start one Workflow for its thread.

### Reply workflow

Begin with these approximate checks after the thread is selected:

- `+10m`
- `+25m`
- `+40m`
- `+55m`
- `+3h`
- `+6h`
- `+24h`

At each step, fetch the current flat post RSS feed, compare it with D1, and
inspect only new or materially changed source objects. Store each observed
version before attempting delivery. A relevant reply is parsed and sent as its
own crowd report; an irrelevant reply is marked evaluated and is not
reconsidered unless its source content changes. Re-evaluate an edited root post
too, because the author may add a rectification such as restored service. Do
not infer deletion from an object being absent from a later feed.

The Workflow completes after the final check. Add a longer watch or deletion
audit only if real operation demonstrates a need.

### Delivery

The site endpoint is:

```text
POST /internal/api/crowd-reports
Authorization: Bearer <producer secret>
Content-Type: application/json
```

An illustrative request is:

```json
{
  "externalReportId": "opaque-source-version-id",
  "sourceUrl": "https://www.reddit.com/r/singapore/comments/.../comment/...",
  "report": {
    "reportScope": "line",
    "observedAt": "2026-07-18T08:00:00+08:00",
    "lineIds": ["CCL"],
    "stationIds": [],
    "effect": "delay",
    "delayMinutes": 10,
    "isStillHappening": true
  }
}
```

The site owns the runtime request schema. This repository should keep its
mapping small and cover it with synthetic request/response tests. Do not add a
vendored OpenAPI artifact or generated client until multiple producers or
observed contract drift justify it.

Treat an acknowledged duplicate as success. Treat malformed input and an
external-ID payload conflict as terminal errors requiring inspection. Retry
temporary network, rate-limit, and server failures according to the response.

## Minimal D1 State

D1 needs to answer four questions:

1. Has this discovery result already been evaluated?
2. Has this relevant thread already started a Workflow?
3. Have this post or reply and this content version already been parsed?
4. Has the corresponding crowd report been acknowledged by the site?

Keep the schema close to those questions. It may use a small thread table and
a source-object table with parsing and delivery columns; it does not need
separate claim, claim-transition, source-event, lease, or outbox models.

The important invariants are:

- storing a selected source object and marking it pending for delivery is
  durable before the site request;
- `(source object, content version)` is evaluated once;
- one relevant thread starts at most one active Workflow;
- `externalReportId` stays stable across retries; and
- an acknowledgement is recorded only after the site accepts the report.

Scheduled discovery and Workflow retries may overlap, so use D1 uniqueness and
short transactions instead of a general leasing subsystem unless contention is
actually observed.

## Reddit Transport

OAuth with a registered client and descriptive user agent is the intended
production mode. While the application is pending, a temporary shadow mode may
use the proven public RSS discovery path and the selected post's bounded RSS
feed only after a canary succeeds from the deployed Cloudflare Worker. The post
feed is normalized as one root plus flat replies; shadow mode does not infer or
reconstruct comment nesting.

There must be no automatic fallback from OAuth to public access. Shadow mode
must remain conservative, honor `Retry-After` and cache validators, and stop on
`401`, `403`, repeated `429`, unexpected content types, or sustained response
shape failures. Switch to OAuth when credentials become available without
changing stored source identities or external report IDs.

## Observed Volume

A 2026-07-17 sample found approximately 54 new posts per day across both target
subreddits and about 2.65 daily matches for a deliberately broad rail-keyword
query. Manual sampling suggested only roughly one to three genuinely live
operational threads per month.

In three representative disruption threads, approximately 77% to 88% of
replies arrived within three hours. The small fixed Workflow schedule above is
therefore sufficient for the first implementation. D1 and Workflows are enough
for this volume; add Queues only after measuring a concrete problem.

## Privacy and Logging

- Store only source text needed for parsing and bounded re-evaluation.
- Do not persist usernames unless a later demonstrated deduplication need
  justifies a pseudonymous short-lived key.
- Remove cached content when Reddit reports it deleted or removed.
- Never log raw post or reply bodies, Reddit usernames, credentials, tokens, or
  full site request payloads.
- Use synthetic Reddit-shaped fixtures in tests.

## Configuration

Expected secrets:

- `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` when OAuth is available;
- `MRTDOWN_SITE_INGEST_TOKEN`;
- parser credentials if the selected parsing implementation requires them.

Expected variables and bindings:

- `REDDIT_TRANSPORT_MODE=oauth|public-shadow`;
- `REDDIT_USER_AGENT_CONTACT`;
- `MRTDOWN_SITE_INGEST_URL`;
- a D1 database binding;
- a Cloudflare Workflow binding;
- configured subreddits and discovery query.

Never commit `.dev.vars`, credentials, API tokens, or production binding IDs.

## Rollout

1. Define the minimal D1 migration and synthetic fixtures.
2. Implement the Reddit transport and discovery schedule.
3. Implement post relevance parsing and programmatic crowd-report delivery.
4. Implement the fixed reply-monitoring Workflow.
5. Run in shadow mode and compare discovery with `mrtdown-data-crawler`.
6. Enable normal site handling after reviewing relevance and update quality.
7. Disable and later remove Reddit from the crawler after a rollback window.

## License

Repository code is available under the [MIT License](LICENSE). Reddit user
content is third-party content and is not covered by that license.
