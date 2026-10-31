CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE TABLE telemetry_events (
  tenant_id text NOT NULL,
  event_id text NOT NULL,
  PRIMARY KEY (tenant_id, event_id)
);
CREATE TABLE telemetry (
  time timestamptz NOT NULL,
  tenant_id text NOT NULL,
  device_id text NOT NULL,
  event_id text NOT NULL,
  value double precision NOT NULL,
  is_anomaly boolean NOT NULL,
  assessment jsonb,
  PRIMARY KEY(time, tenant_id, event_id)
);
SELECT create_hypertable('telemetry', by_range('time', INTERVAL '1 day'));
CREATE INDEX ON telemetry (tenant_id, device_id, time DESC);
SELECT add_retention_policy('telemetry', INTERVAL '90 days');
