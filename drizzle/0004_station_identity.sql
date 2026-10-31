CREATE TABLE IF NOT EXISTS station_accounts (
 user_id TEXT PRIMARY KEY REFERENCES users(id), organization_id TEXT NOT NULL REFERENCES organizations(id),
 email TEXT NOT NULL, password_hash TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0,
 UNIQUE(organization_id,email)
);
CREATE TABLE IF NOT EXISTS station_grants (
 user_id TEXT NOT NULL REFERENCES station_accounts(user_id), site TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('admin','operator','readonly')),
 scope TEXT NOT NULL CHECK(scope IN ('front','back')), enabled INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(user_id,site)
);
CREATE TABLE IF NOT EXISTS station_sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES station_accounts(user_id), expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS station_sessions_user ON station_sessions(user_id);
CREATE TABLE IF NOT EXISTS station_login_limits (
 key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset_at INTEGER NOT NULL
);
