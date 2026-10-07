CREATE TABLE IF NOT EXISTS onyx_email_logs (
  id TEXT PRIMARY KEY,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS onyx_telemetry_logs (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  status TEXT NOT NULL,
  payload TEXT NOT NULL,
  synced INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS onyx_telemetry_logs_unsynced
  ON onyx_telemetry_logs (synced, created_at);

CREATE TABLE IF NOT EXISTS onyx_rate_limit_logs (
  id TEXT PRIMARY KEY,
  ip_address TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  user_id TEXT NOT NULL,
  blocked_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS onyx_rate_limit_logs_endpoint
  ON onyx_rate_limit_logs (endpoint);

CREATE TABLE IF NOT EXISTS onyx_command_audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  command_type TEXT NOT NULL,
  status TEXT NOT NULL,
  execution_time_ms INTEGER NOT NULL,
  details TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS onyx_user_sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  client_version TEXT NOT NULL,
  last_seen INTEGER NOT NULL
);
