# mrtdown-reddit-monitor

Stateful Reddit thread and reply monitoring for MRTDown community signals.

> This repository currently contains the design boundary only. The Cloudflare
> Worker, D1 schema, tests, and deployment configuration have not been
> scaffolded yet.

## Purpose

`mrtdown-reddit-monitor` discovers potentially relevant Singapore rail threads,
watches their replies, detects edits and deletions, and delivers source events
to `mrtdown-site` for classification and moderation.

It is an acquisition adapter, not a canonical-data writer and not the owner of
community-signal product decisions.

```text
Reddit Data API
    -> mrtdown-reddit-monitor
       discovery, polling, source lifecycle, delivery retries
    -> mrtdown-site
       classification, moderation, confidence, public signals
    -> mrtdown-data
       accepted canonical evidence and impact
```

The paired site-side implementation plan is:

- `../mrtdown-site/docs/plans/active/reddit-community-monitoring.md`

## Responsibilities

- Use a registered, authenticated Reddit API client and descriptive user agent.
- Discover newly created candidate threads from configured communities and
  queries.
- Maintain durable watch schedules for relevant or potentially relevant
  threads.
- Detect new comments, edits, removals, deletions, and source lifecycle changes.
- Preserve thread/comment parent relationships and source timestamps.
- Generate privacy-preserving author keys for short-window distinct-author
  counting without sending Reddit usernames to the site.
- Deliver versioned, authenticated event batches to `mrtdown-site`.
- Retry delivery through a durable outbox without duplicating source events.
- Minimize cached Reddit content and propagate deletions promptly.
- Respect API rate-limit headers and back off safely.

## Non-Responsibilities

- Do not submit events through the public `mrtdown-site` `/api/reports`
  endpoint. It is a human-report boundary with separate abuse and confidence
  assumptions.
- Do not dispatch directly to `mrtdown-data` or create canonical issue records.
- Do not decide that a Reddit conversation is a confirmed service disruption.
- Do not count every comment as an independent commuter report.
- Do not own public community-signal pages or canonical evidence pages.
- Do not retain Reddit usernames, profiles, or raw content indefinitely.
- Do not bypass Reddit authentication or scrape unidentified web endpoints when
  an authorized API boundary is required.

## Proposed Runtime

The expected runtime is a scheduled Cloudflare Worker with D1-backed state.
Exact bindings and schedules will be added when the Worker is scaffolded.

The separate Worker boundary is about workload shape, not computational scale.
Reddit discovery requires frequent mostly empty polls, while `mrtdown-site` runs
on Fly.io and may scale to zero. Keeping discovery here avoids waking the site
hundreds of times per day merely to find no relevant content. The Worker should
wake the site only when a source object is new, changed, removed, or deleted.

The Worker needs three durable capabilities:

1. Discovery state: query/community cursors and already-seen thread IDs.
2. Watch state: due threads, known comments and source versions, next-poll time,
   watch expiry, and deletion state.
3. Delivery state: a transactional outbox of source events awaiting site
   acknowledgement.

The July 2026 volume sample does not justify Cloudflare Queues. Use a D1 work
queue and transactional outbox initially. Introduce Queues only if measured
polling or delivery concurrency outgrows that design.

## Observed Volume

The initial baseline was sampled on 2026-07-17 from the 100 newest submissions
and the 100 newest broad rail-keyword search results in each target subreddit.
Treat it as a starting measurement, not a permanent capacity assumption.

| Subreddit | Span of 100 newest posts | Approximate post rate | Broad rail-keyword candidates |
| --- | ---: | ---: | ---: |
| `r/singapore` | 5.14 days | 19.4 per day | 0.95 per day |
| `r/askSingapore` | 2.91 days | 34.4 per day | 1.70 per day |
| Combined | — | about 54 per day | about 2.65 per day |

The candidate query was intentionally broad: `MRT OR LRT OR train OR SMRT`.
Most matches were not live operational observations. False positives included
AI and vocational training, bus contracts, food near stations, mobile
reception, lost property, and general transport questions. Manual review found
roughly one to three genuinely live operational threads per month across both
subreddits, with duplicate posts possible during a disruption.

Reply traffic is bursty when a useful thread does appear:

| Reference thread | Observed replies | First hour | First three hours | First six hours |
| --- | ---: | ---: | ---: | ---: |
| [Unannounced CCL delay](https://www.reddit.com/r/askSingapore/comments/1upg9zr/unannounced_train_service_disruption_or_delays/) | 24 | 17 | 21 | 24 |
| [TEL major delay](https://www.reddit.com/r/singapore/comments/1t25wqm/tel_has_another_major_delay_no_services_between/) | 28 | 15 | 22 | 25 |
| [CCL train delay](https://www.reddit.com/r/singapore/comments/1kqrfgn/there_is_a_train_delay_along_the_circle_line/) | 92 | 48 | 71 | 79 |

Across these examples, about 77% to 88% of replies arrived within three hours.
The replies included useful station-specific confirmations, changing delay
estimates, crowding, forced alighting, and clearance observations, alongside a
larger amount of commentary, jokes, speculation, and repeated claims. Original
post edits also matter: a representative
[TEL track-fault thread](https://www.reddit.com/r/singapore/comments/1rjnd4f/track_fault_on_tel/)
was updated when trains resumed after 28 minutes.

At a five-minute cadence, polling two subreddit discovery listings uses 576
requests per day, averaging 0.4 requests per minute. The initial adaptive watch
profile below adds about 84 requests for a thread watched for 24 hours. This is
well below Reddit's documented free-access limit of 100 queries per minute per
OAuth client, averaged over ten minutes, but the implementation must still
authenticate, inspect rate-limit headers, and back off. See the
[Reddit Data API guidance](https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki).

Public RSS was used for this bounded research sample. Production monitoring
must use an authorized authenticated API boundary and remeasure volume during
shadow mode.

## Proposed Polling Lifecycle

1. A discovery schedule queries configured Reddit communities for new candidate
   threads.
2. Cheap deterministic filters discard obvious non-rail content. Borderline
   candidates are retained for site-side classification rather than rejected
   aggressively in the Worker.
3. New candidates receive a watch record and an initial thread snapshot event.
4. Due watch records fetch the current conversation, compare source versions
   with known objects, and enqueue new, edited, removed, or deleted events.
5. Start with this adaptive watch profile for a relevant conversation:
   - every two minutes for its first hour;
   - every five minutes for the next two hours;
   - every 15 minutes for the next three hours;
   - hourly until 24 hours after discovery;
   - stop or move to a much slower deletion-audit schedule after resolution or
     watch expiry.
6. A delivery loop posts batches from the outbox to the authenticated site
   endpoint and marks individual events acknowledged.
7. Expired raw content is purged while minimal delivery and deletion tombstones
   remain long enough to prevent replay.

Run discovery every five minutes initially. Make all intervals configurable and
calibrate watch duration, discovery breadth, and relevance thresholds during
shadow mode. The measured starting profile is a safe default, not a reason to
hard-code policy into the scheduler.

## Proposed State Model

Names are provisional. Create D1 migrations through Wrangler when the Worker is
implemented.

### `discovery_cursors`

- source query or community key;
- cursor/watermark;
- last attempted and successful fetch times;
- backoff and error state.

### `watched_threads`

- Reddit thread fullname;
- subreddit and permalink;
- discovery and source creation times;
- relevance/watch status;
- next poll and watch expiry times;
- last observed source version;
- removal/deletion state.

### `source_objects`

- Reddit fullname and kind (`thread` or `comment`);
- thread and parent fullnames;
- source creation/edit times;
- deterministic content version;
- pseudonymous author key;
- bounded title/body cache;
- removal/deletion and content-expiry times.

### `delivery_outbox`

- stable producer event ID;
- event kind and schema version;
- serialized payload;
- creation, next-attempt, and acknowledgement times;
- attempt count and last error.

Source-object updates and corresponding outbox inserts must commit in one D1
transaction so a Worker interruption cannot lose a detected event.

## Site Event Contract

The Worker will post a versioned batch to a dedicated authenticated
`mrtdown-site` endpoint, provisionally:

```text
POST /internal/api/sources/reddit/events
```

The route name and schema are not final. The site plan owns the final boundary.
An illustrative envelope is:

```json
{
  "schemaVersion": 1,
  "producer": "mrtdown-reddit-monitor",
  "batchId": "batch_01...",
  "events": [
    {
      "eventId": "reddit:t1_example:version:2026-07-17T09:12:00Z",
      "kind": "source.upsert",
      "occurredAt": "2026-07-17T09:12:03Z",
      "source": {
        "platform": "reddit",
        "objectKind": "comment",
        "externalId": "t1_example",
        "threadExternalId": "t3_example",
        "parentExternalId": "t1_parent",
        "permalink": "https://www.reddit.com/r/singapore/comments/.../comment/...",
        "createdAt": "2026-07-17T09:10:00Z",
        "editedAt": null,
        "version": "sha256:...",
        "authorKey": "hmac:..."
      },
      "content": {
        "title": null,
        "body": "Example source text retained only for bounded moderation"
      }
    }
  ]
}
```

A deletion is a distinct event with the same source identity and a newer source
version. Delayed upserts must not resurrect an object after a newer deletion.

The final contract must define:

- authentication and secret rotation;
- maximum batch and event sizes;
- per-event acknowledgement and retry behavior;
- stable event-ID construction;
- source-version ordering;
- deletion and purge semantics;
- author-key derivation and rotation;
- permalink retention after upstream deletion.

## Privacy And Retention

- Never deliver Reddit usernames, profile URLs, avatars, flair, or other author
  metadata to the site.
- Derive `authorKey` using a secret-keyed HMAC. Do not use a plain username
  hash, which is reversible by enumeration.
- Scope and rotate author keys according to the site's confidence window and
  audit requirements.
- Keep raw title/body content only while needed for classification, edit/delete
  detection, and bounded replay.
- Propagate source removals and deletions as first-class events.
- Purge expired raw content on a recurring schedule and test the purge path.
- Retain only minimal tombstones needed for idempotency after content removal.
- Do not log raw bodies, OAuth tokens, author identifiers, or complete event
  payloads in production.

Before production access, review the current Reddit Developer Terms, Data API
Terms, authentication requirements, rate limits, attribution requirements, and
deletion guidance. Treat that review as a release gate, not documentation-only
work.

## Configuration

Names are provisional until Wrangler scaffolding is created.

Expected secrets:

- `REDDIT_CLIENT_ID`
- `REDDIT_CLIENT_SECRET`
- `REDDIT_USER_AGENT_CONTACT`
- `MRTDOWN_SITE_INGEST_TOKEN`
- `AUTHOR_KEY_SECRET`
- `SENTRY_DSN` if Sentry is adopted

Expected non-secret variables:

- `MRTDOWN_SITE_INGEST_URL`
- `ENVIRONMENT`
- configured subreddits and discovery queries
- content-retention and tombstone-retention durations
- polling/backoff limits

Expected bindings:

- a D1 database, provisionally `DB`;
- Cloudflare version metadata if release correlation is needed.

Never commit `.dev.vars`, OAuth credentials, API tokens, or production IDs.

## Observability

Emit structured metadata without raw Reddit content:

- discovery requests, candidates, and cursors;
- watched-thread counts by state;
- polls due, completed, backed off, and failed;
- new, edited, removed, and deleted source objects;
- outbox depth, delivery latency, attempts, and terminal errors;
- Reddit rate-limit remaining/reset values;
- raw-content purge counts and oldest retained-content age.

Alerts should cover sustained authentication failure, rate-limit exhaustion,
stalled discovery, overdue watch records, growing outbox depth, and failed
deletion propagation.

## Development Status

There are no install, development, test, migration, or deployment commands yet.
When scaffolding is added, the repository should provide at least:

- deterministic unit tests for discovery filtering, conversation diffs, event
  IDs, stale-version ordering, deletion, backoff, and author-key derivation;
- D1-backed integration tests for transactional outbox behavior;
- contract fixtures shared with or validated against `mrtdown-site`;
- `typecheck`, `lint`, `test`, and migration-drift commands;
- a local scheduled-event workflow using Wrangler;
- separate preview/staging and production configuration;
- CI that runs deterministic checks without calling Reddit or the site.

Do not use production Reddit content in checked-in fixtures. Prefer synthetic
threads and comments that exercise the same event shapes.

## Rollout

1. Scaffold the Worker, D1 migrations, tests, and CI.
2. Agree on the Worker-to-site event contract.
3. Implement discovery, watch scheduling, conversation diffs, and the outbox.
4. Run against the site's private shadow-ingest path with public and canonical
   output disabled.
5. Measure coverage, relevance, reply utility, edit/delete behavior, API cost,
   and suitable polling backoff.
6. Enable site-side community signals after confidence and lifecycle rules are
   validated.
7. Enable canonical community-signal dispatch only after its separate contract
   and provenance model are complete.
8. Disable Reddit in `mrtdown-data-crawler`, observe the cutover, and then
   remove the obsolete producer code.

## Open Decisions

- Which subreddits and discovery queries should be in the initial shadow set?
- What qualifies a thread for reply monitoring, and who can override that
  decision?
- How long should active, quiet, and resolved conversations remain watched?
- Should the Worker send raw text for site-side classification, or perform a
  first structured extraction and send both within a short retention window?
- How should edit versions be ordered when Reddit supplies no useful edit
  timestamp?
- How should author-key rotation balance short-window distinct-author counting
  with deletion and privacy requirements?
- When may a Reddit permalink remain on the site after upstream deletion?
- What measured D1 contention, outbox depth, or delivery latency would justify
  introducing Cloudflare Queues later?
- What evidence is required before retiring the crawler's RSS discovery path?

## License

Add an explicit code license when the Worker is scaffolded. Reddit user content
is third-party content and is not covered by any future repository code
license.
