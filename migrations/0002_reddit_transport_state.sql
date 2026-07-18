CREATE TABLE reddit_transport_state (
  transport TEXT PRIMARY KEY CHECK (transport = 'public-shadow'),
  blocked_until TEXT,
  disabled_reason TEXT
    CHECK (
      disabled_reason IS NULL
      OR disabled_reason IN (
        'authentication',
        'blocked',
        'invalid_content_type',
        'repeated_rate_limited',
        'sustained_shape_failure'
      )
    ),
  consecutive_rate_limits INTEGER NOT NULL DEFAULT 0
    CHECK (consecutive_rate_limits >= 0),
  consecutive_shape_failures INTEGER NOT NULL DEFAULT 0
    CHECK (consecutive_shape_failures >= 0),
  last_attempt_at TEXT NOT NULL,
  last_success_at TEXT,
  rate_limit_remaining REAL CHECK (
    rate_limit_remaining IS NULL OR rate_limit_remaining >= 0
  ),
  rate_limit_reset_at TEXT
);
