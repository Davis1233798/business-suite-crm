-- MES PostgreSQL projection: revision metadata is not restorable business data.
CREATE TABLE IF NOT EXISTS suite_migrations (name TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS mes_projection_revisions (
  organization_id TEXT NOT NULL,
  work_order_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  PRIMARY KEY (organization_id, work_order_id)
);
CREATE INDEX IF NOT EXISTS outbox_pending_dispatch_idx ON outbox_events(event_type,status,created_at,id);

CREATE TRIGGER IF NOT EXISTS mes_work_orders_projection_insert
AFTER INSERT ON mes_work_orders
BEGIN
  INSERT INTO mes_projection_revisions(organization_id, work_order_id, revision)
    VALUES (NEW.organization_id, NEW.id, 1)
    ON CONFLICT(organization_id, work_order_id) DO UPDATE SET revision=revision+1;
  INSERT INTO outbox_events(id, organization_id, event_type, payload)
    VALUES ('mes:' || lower(hex(randomblob(16))), NEW.organization_id, 'mes.work-order.changed',
      json_object('workOrderId', NEW.id));
END;

CREATE TRIGGER IF NOT EXISTS mes_work_orders_projection_update
AFTER UPDATE ON mes_work_orders
BEGIN
  INSERT INTO mes_projection_revisions(organization_id, work_order_id, revision)
    VALUES (NEW.organization_id, NEW.id, 1)
    ON CONFLICT(organization_id, work_order_id) DO UPDATE SET revision=revision+1;
  INSERT INTO outbox_events(id, organization_id, event_type, payload)
    VALUES ('mes:' || lower(hex(randomblob(16))), NEW.organization_id, 'mes.work-order.changed',
      json_object('workOrderId', NEW.id));
END;

CREATE TRIGGER IF NOT EXISTS mes_work_orders_projection_delete
AFTER DELETE ON mes_work_orders
BEGIN
  INSERT INTO mes_projection_revisions(organization_id, work_order_id, revision)
    VALUES (OLD.organization_id, OLD.id, 1)
    ON CONFLICT(organization_id, work_order_id) DO UPDATE SET revision=revision+1;
  INSERT INTO outbox_events(id, organization_id, event_type, payload)
    VALUES ('mes:' || lower(hex(randomblob(16))), OLD.organization_id, 'mes.work-order.changed',
      json_object('workOrderId', OLD.id));
END;

CREATE TRIGGER IF NOT EXISTS mes_operations_projection_insert
AFTER INSERT ON mes_operations
BEGIN
  INSERT INTO mes_projection_revisions(organization_id, work_order_id, revision)
    VALUES (NEW.organization_id, NEW.work_order_id, 1)
    ON CONFLICT(organization_id, work_order_id) DO UPDATE SET revision=revision+1;
  INSERT INTO outbox_events(id, organization_id, event_type, payload)
    VALUES ('mes:' || lower(hex(randomblob(16))), NEW.organization_id, 'mes.work-order.changed',
      json_object('workOrderId', NEW.work_order_id));
END;

CREATE TRIGGER IF NOT EXISTS mes_operations_projection_update
AFTER UPDATE ON mes_operations
BEGIN
  INSERT INTO mes_projection_revisions(organization_id, work_order_id, revision)
    VALUES (NEW.organization_id, NEW.work_order_id, 1)
    ON CONFLICT(organization_id, work_order_id) DO UPDATE SET revision=revision+1;
  INSERT INTO outbox_events(id, organization_id, event_type, payload)
    VALUES ('mes:' || lower(hex(randomblob(16))), NEW.organization_id, 'mes.work-order.changed',
      json_object('workOrderId', NEW.work_order_id));
END;

CREATE TRIGGER IF NOT EXISTS mes_operations_projection_delete
AFTER DELETE ON mes_operations
BEGIN
  INSERT INTO mes_projection_revisions(organization_id, work_order_id, revision)
    VALUES (OLD.organization_id, OLD.work_order_id, 1)
    ON CONFLICT(organization_id, work_order_id) DO UPDATE SET revision=revision+1;
  INSERT INTO outbox_events(id, organization_id, event_type, payload)
    VALUES ('mes:' || lower(hex(randomblob(16))), OLD.organization_id, 'mes.work-order.changed',
      json_object('workOrderId', OLD.work_order_id));
END;

CREATE TRIGGER IF NOT EXISTS mes_work_order_materials_projection_insert
AFTER INSERT ON mes_work_order_materials
BEGIN
  INSERT INTO mes_projection_revisions(organization_id, work_order_id, revision)
    VALUES (NEW.organization_id, NEW.work_order_id, 1)
    ON CONFLICT(organization_id, work_order_id) DO UPDATE SET revision=revision+1;
  INSERT INTO outbox_events(id, organization_id, event_type, payload)
    VALUES ('mes:' || lower(hex(randomblob(16))), NEW.organization_id, 'mes.work-order.changed',
      json_object('workOrderId', NEW.work_order_id));
END;

CREATE TRIGGER IF NOT EXISTS mes_work_order_materials_projection_update
AFTER UPDATE ON mes_work_order_materials
BEGIN
  INSERT INTO mes_projection_revisions(organization_id, work_order_id, revision)
    VALUES (NEW.organization_id, NEW.work_order_id, 1)
    ON CONFLICT(organization_id, work_order_id) DO UPDATE SET revision=revision+1;
  INSERT INTO outbox_events(id, organization_id, event_type, payload)
    VALUES ('mes:' || lower(hex(randomblob(16))), NEW.organization_id, 'mes.work-order.changed',
      json_object('workOrderId', NEW.work_order_id));
END;

CREATE TRIGGER IF NOT EXISTS mes_work_order_materials_projection_delete
AFTER DELETE ON mes_work_order_materials
BEGIN
  INSERT INTO mes_projection_revisions(organization_id, work_order_id, revision)
    VALUES (OLD.organization_id, OLD.work_order_id, 1)
    ON CONFLICT(organization_id, work_order_id) DO UPDATE SET revision=revision+1;
  INSERT INTO outbox_events(id, organization_id, event_type, payload)
    VALUES ('mes:' || lower(hex(randomblob(16))), OLD.organization_id, 'mes.work-order.changed',
      json_object('workOrderId', OLD.work_order_id));
END;

CREATE TRIGGER IF NOT EXISTS mes_production_reports_projection_insert
AFTER INSERT ON mes_production_reports
BEGIN
  INSERT INTO mes_projection_revisions(organization_id, work_order_id, revision)
    VALUES (NEW.organization_id, NEW.work_order_id, 1)
    ON CONFLICT(organization_id, work_order_id) DO UPDATE SET revision=revision+1;
  INSERT INTO outbox_events(id, organization_id, event_type, payload)
    VALUES ('mes:' || lower(hex(randomblob(16))), NEW.organization_id, 'mes.work-order.changed',
      json_object('workOrderId', NEW.work_order_id));
END;

CREATE TRIGGER IF NOT EXISTS mes_production_reports_projection_update
AFTER UPDATE ON mes_production_reports
BEGIN
  INSERT INTO mes_projection_revisions(organization_id, work_order_id, revision)
    VALUES (NEW.organization_id, NEW.work_order_id, 1)
    ON CONFLICT(organization_id, work_order_id) DO UPDATE SET revision=revision+1;
  INSERT INTO outbox_events(id, organization_id, event_type, payload)
    VALUES ('mes:' || lower(hex(randomblob(16))), NEW.organization_id, 'mes.work-order.changed',
      json_object('workOrderId', NEW.work_order_id));
END;

CREATE TRIGGER IF NOT EXISTS mes_production_reports_projection_delete
AFTER DELETE ON mes_production_reports
BEGIN
  INSERT INTO mes_projection_revisions(organization_id, work_order_id, revision)
    VALUES (OLD.organization_id, OLD.work_order_id, 1)
    ON CONFLICT(organization_id, work_order_id) DO UPDATE SET revision=revision+1;
  INSERT INTO outbox_events(id, organization_id, event_type, payload)
    VALUES ('mes:' || lower(hex(randomblob(16))), OLD.organization_id, 'mes.work-order.changed',
      json_object('workOrderId', OLD.work_order_id));
END;

CREATE TRIGGER IF NOT EXISTS mes_quality_checks_projection_insert
AFTER INSERT ON mes_quality_checks
BEGIN
  INSERT INTO mes_projection_revisions(organization_id, work_order_id, revision)
    VALUES (NEW.organization_id, NEW.work_order_id, 1)
    ON CONFLICT(organization_id, work_order_id) DO UPDATE SET revision=revision+1;
  INSERT INTO outbox_events(id, organization_id, event_type, payload)
    VALUES ('mes:' || lower(hex(randomblob(16))), NEW.organization_id, 'mes.work-order.changed',
      json_object('workOrderId', NEW.work_order_id));
END;

CREATE TRIGGER IF NOT EXISTS mes_quality_checks_projection_update
AFTER UPDATE ON mes_quality_checks
BEGIN
  INSERT INTO mes_projection_revisions(organization_id, work_order_id, revision)
    VALUES (NEW.organization_id, NEW.work_order_id, 1)
    ON CONFLICT(organization_id, work_order_id) DO UPDATE SET revision=revision+1;
  INSERT INTO outbox_events(id, organization_id, event_type, payload)
    VALUES ('mes:' || lower(hex(randomblob(16))), NEW.organization_id, 'mes.work-order.changed',
      json_object('workOrderId', NEW.work_order_id));
END;

CREATE TRIGGER IF NOT EXISTS mes_quality_checks_projection_delete
AFTER DELETE ON mes_quality_checks
BEGIN
  INSERT INTO mes_projection_revisions(organization_id, work_order_id, revision)
    VALUES (OLD.organization_id, OLD.work_order_id, 1)
    ON CONFLICT(organization_id, work_order_id) DO UPDATE SET revision=revision+1;
  INSERT INTO outbox_events(id, organization_id, event_type, payload)
    VALUES ('mes:' || lower(hex(randomblob(16))), OLD.organization_id, 'mes.work-order.changed',
      json_object('workOrderId', OLD.work_order_id));
END;

-- Initial backfill is queued exactly once; ordinary writes use the triggers.
INSERT OR IGNORE INTO mes_projection_revisions(organization_id,work_order_id,revision)
  SELECT organization_id,id,1 FROM mes_work_orders
  WHERE NOT EXISTS(SELECT 1 FROM suite_migrations WHERE name='0003_mes_projection');
INSERT OR IGNORE INTO outbox_events(id,organization_id,event_type,payload)
  SELECT 'mes.backfill:' || organization_id || ':' || id, organization_id,
    'mes.work-order.changed', json_object('workOrderId',id)
  FROM mes_work_orders
  WHERE NOT EXISTS(SELECT 1 FROM suite_migrations WHERE name='0003_mes_projection');
INSERT OR IGNORE INTO suite_migrations(name) VALUES ('0003_mes_projection');
