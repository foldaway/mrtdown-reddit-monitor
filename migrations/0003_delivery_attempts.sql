ALTER TABLE reddit_source_objects
  ADD COLUMN delivery_attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (delivery_attempt_count >= 0);

ALTER TABLE reddit_source_objects
  ADD COLUMN delivery_last_attempted_at TEXT;

ALTER TABLE reddit_source_objects
  ADD COLUMN delivery_error_category TEXT
    CHECK (
      delivery_error_category IS NULL
      OR delivery_error_category IN (
        'authentication',
        'idempotency_conflict',
        'invalid_content_type',
        'invalid_request',
        'invalid_response',
        'network',
        'rate_limited',
        'response_too_large',
        'server',
        'unexpected_status'
      )
    );

ALTER TABLE reddit_source_objects
  ADD COLUMN delivery_retry_at TEXT;

ALTER TABLE reddit_source_objects
  ADD COLUMN delivery_terminal INTEGER NOT NULL DEFAULT 0
    CHECK (delivery_terminal IN (0, 1));

CREATE INDEX reddit_source_objects_ready_delivery
  ON reddit_source_objects (delivery_retry_at, first_seen_at)
  WHERE delivery_status = 'pending' AND delivery_terminal = 0;
