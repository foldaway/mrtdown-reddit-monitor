ALTER TABLE reddit_discovery_candidates
  ADD COLUMN hydration_failure_count INTEGER NOT NULL DEFAULT 0
  CHECK (hydration_failure_count >= 0);

ALTER TABLE reddit_discovery_candidates
  ADD COLUMN hydration_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (hydration_status IN ('pending', 'quarantined'));

ALTER TABLE reddit_discovery_candidates
  ADD COLUMN last_hydration_failure_at TEXT;

DROP INDEX reddit_discovery_candidates_pending;

CREATE INDEX reddit_discovery_candidates_pending
  ON reddit_discovery_candidates (
    hydration_failure_count, first_discovered_at, thread_external_id
  )
  WHERE hydration_status = 'pending';
