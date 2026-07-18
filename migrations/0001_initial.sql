PRAGMA foreign_keys = ON;

CREATE TABLE reddit_threads (
  thread_external_id TEXT PRIMARY KEY,
  subreddit TEXT NOT NULL,
  selection_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (selection_status IN ('pending', 'irrelevant', 'selected')),
  workflow_id TEXT UNIQUE,
  workflow_assigned_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  UNIQUE (thread_external_id, subreddit),
  CHECK (
    (workflow_id IS NULL AND workflow_assigned_at IS NULL)
    OR (
      workflow_id IS NOT NULL
      AND workflow_assigned_at IS NOT NULL
      AND selection_status = 'selected'
    )
  )
);

CREATE TABLE reddit_source_objects (
  source_external_id TEXT NOT NULL,
  content_version TEXT NOT NULL,
  thread_external_id TEXT NOT NULL,
  parent_external_id TEXT,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('post', 'reply')),
  subreddit TEXT NOT NULL,
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('active', 'removed', 'deleted')),
  source_url TEXT,
  source_created_at TEXT NOT NULL,
  source_updated_at TEXT NOT NULL,
  title TEXT,
  body TEXT,
  is_current INTEGER NOT NULL CHECK (is_current IN (0, 1)),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  evaluation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (evaluation_status IN ('pending', 'superseded', 'irrelevant', 'report')),
  evaluated_at TEXT,
  parsed_report_json TEXT,
  external_report_id TEXT UNIQUE,
  delivery_status TEXT NOT NULL DEFAULT 'none'
    CHECK (delivery_status IN ('none', 'pending', 'acknowledged')),
  site_report_id TEXT,
  moderation_status TEXT
    CHECK (
      moderation_status IS NULL
      OR moderation_status IN ('pending', 'accepted', 'rejected', 'duplicate', 'dispatched')
    ),
  acknowledged_at TEXT,
  PRIMARY KEY (source_external_id, content_version),
  FOREIGN KEY (thread_external_id, subreddit)
    REFERENCES reddit_threads (thread_external_id, subreddit),
  CHECK (
    (source_kind = 'post' AND source_external_id = thread_external_id AND parent_external_id IS NULL)
    OR source_kind = 'reply'
  ),
  CHECK (
    lifecycle = 'active'
    OR (title IS NULL AND body IS NULL)
  ),
  CHECK (
    (evaluation_status = 'pending'
      AND evaluated_at IS NULL
      AND parsed_report_json IS NULL
      AND external_report_id IS NULL
      AND delivery_status = 'none')
    OR (evaluation_status IN ('superseded', 'irrelevant')
      AND evaluated_at IS NOT NULL
      AND parsed_report_json IS NULL
      AND external_report_id IS NULL
      AND delivery_status = 'none')
    OR (evaluation_status = 'report'
      AND evaluated_at IS NOT NULL
      AND parsed_report_json IS NOT NULL
      AND external_report_id IS NOT NULL
      AND delivery_status IN ('pending', 'acknowledged'))
  ),
  CHECK (
    (delivery_status != 'acknowledged'
      AND site_report_id IS NULL
      AND moderation_status IS NULL
      AND acknowledged_at IS NULL)
    OR (delivery_status = 'acknowledged'
      AND site_report_id IS NOT NULL
      AND moderation_status IS NOT NULL
      AND acknowledged_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX reddit_source_objects_one_current_version
  ON reddit_source_objects (source_external_id)
  WHERE is_current = 1;

CREATE INDEX reddit_source_objects_by_thread
  ON reddit_source_objects (thread_external_id, is_current);

CREATE INDEX reddit_source_objects_pending_delivery
  ON reddit_source_objects (first_seen_at)
  WHERE delivery_status = 'pending';
