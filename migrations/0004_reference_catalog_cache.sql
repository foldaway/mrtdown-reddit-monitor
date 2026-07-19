CREATE TABLE site_reference_catalog_cache (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  dataset_version TEXT NOT NULL,
  reference_date TEXT NOT NULL,
  catalog_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
