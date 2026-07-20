ALTER TABLE reddit_threads
  ADD COLUMN workflow_completed_at TEXT;

CREATE INDEX reddit_threads_active_workflow
  ON reddit_threads (workflow_started_at, thread_external_id)
  WHERE selection_status = 'selected'
    AND workflow_started_at IS NOT NULL
    AND workflow_completed_at IS NULL;
