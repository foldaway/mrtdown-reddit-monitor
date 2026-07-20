ALTER TABLE reddit_threads
  ADD COLUMN workflow_started_at TEXT;

CREATE INDEX reddit_threads_selected_workflow_start
  ON reddit_threads (workflow_assigned_at, thread_external_id)
  WHERE selection_status = 'selected' AND workflow_started_at IS NULL;
