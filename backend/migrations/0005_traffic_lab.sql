CREATE TABLE IF NOT EXISTS traffic_runs (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, site TEXT NOT NULL,
 capacity INTEGER NOT NULL CHECK(capacity BETWEEN 1 AND 1000),
 committed INTEGER NOT NULL DEFAULT 0 CHECK(committed >= 0 AND committed <= capacity),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS traffic_records (
 run_id TEXT NOT NULL REFERENCES traffic_runs(id) ON DELETE CASCADE,
 request_key TEXT NOT NULL, sequence INTEGER NOT NULL, processed INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(run_id,request_key), UNIQUE(run_id,sequence)
);
