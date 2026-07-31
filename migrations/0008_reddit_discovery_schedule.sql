CREATE TABLE reddit_discovery_schedule (
  schedule TEXT PRIMARY KEY CHECK (schedule = 'public-shadow'),
  next_subreddit TEXT NOT NULL
);
