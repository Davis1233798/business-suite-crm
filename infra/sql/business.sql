-- Same schema on both physical databases. Tenant routing uses SHA256 v1, 2 shards.
CREATE TABLE catalog (
  tenant_id text NOT NULL,
  id text NOT NULL,
  name text NOT NULL,
  price integer NOT NULL CHECK (price >= 0),
  PRIMARY KEY (tenant_id, id)
);
CREATE TABLE processed_events (
  tenant_id text NOT NULL,
  event_id text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, event_id)
);
CREATE TABLE fulfillment_jobs (
  tenant_id text NOT NULL,
  event_id text NOT NULL,
  order_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, event_id)
);
-- Tenant hash partitions inside each physical database.
CREATE TABLE mes_work_orders (
  tenant_id text NOT NULL,
  id text NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY (tenant_id, id)
) PARTITION BY HASH (tenant_id);
CREATE TABLE mes_work_orders_p0 PARTITION OF mes_work_orders FOR VALUES WITH (MODULUS 4, REMAINDER 0);
CREATE TABLE mes_work_orders_p1 PARTITION OF mes_work_orders FOR VALUES WITH (MODULUS 4, REMAINDER 1);
CREATE TABLE mes_work_orders_p2 PARTITION OF mes_work_orders FOR VALUES WITH (MODULUS 4, REMAINDER 2);
CREATE TABLE mes_work_orders_p3 PARTITION OF mes_work_orders FOR VALUES WITH (MODULUS 4, REMAINDER 3);
