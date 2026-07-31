CREATE TABLE reddit_discovery_candidates (
  thread_external_id TEXT PRIMARY KEY,
  subreddit TEXT NOT NULL,
  first_discovered_at TEXT NOT NULL,
  last_discovered_at TEXT NOT NULL
);

CREATE INDEX reddit_discovery_candidates_pending
  ON reddit_discovery_candidates (first_discovered_at, thread_external_id);
