"""Generate SQLite/D1 triggers; the resulting SQL is the deployable migration."""
from pathlib import Path

sql = ['''-- MES PostgreSQL projection: revision metadata is not restorable business data.
CREATE TABLE IF NOT EXISTS suite_migrations (name TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS mes_projection_revisions (
  organization_id TEXT NOT NULL,
  work_order_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  PRIMARY KEY (organization_id, work_order_id)
);
CREATE INDEX IF NOT EXISTS outbox_pending_dispatch_idx ON outbox_events(event_type,status,created_at,id);
''']
for table, key in [('mes_work_orders','id'),('mes_operations','work_order_id'),('mes_work_order_materials','work_order_id'),('mes_production_reports','work_order_id'),('mes_quality_checks','work_order_id')]:
    for action in ['INSERT','UPDATE','DELETE']:
        row = 'OLD' if action == 'DELETE' else 'NEW'
        sql.append(f'''CREATE TRIGGER IF NOT EXISTS {table}_projection_{action.lower()}
AFTER {action} ON {table}
BEGIN
  INSERT INTO mes_projection_revisions(organization_id, work_order_id, revision)
    VALUES ({row}.organization_id, {row}.{key}, 1)
    ON CONFLICT(organization_id, work_order_id) DO UPDATE SET revision=revision+1;
  INSERT INTO outbox_events(id, organization_id, event_type, payload)
    VALUES ('mes:' || lower(hex(randomblob(16))), {row}.organization_id, 'mes.work-order.changed',
      json_object('workOrderId', {row}.{key}));
END;
''')
sql.append('''-- Initial backfill is queued exactly once; ordinary writes use the triggers.
INSERT OR IGNORE INTO mes_projection_revisions(organization_id,work_order_id,revision)
  SELECT organization_id,id,1 FROM mes_work_orders
  WHERE NOT EXISTS(SELECT 1 FROM suite_migrations WHERE name='0003_mes_projection');
INSERT OR IGNORE INTO outbox_events(id,organization_id,event_type,payload)
  SELECT 'mes.backfill:' || organization_id || ':' || id, organization_id,
    'mes.work-order.changed', json_object('workOrderId',id)
  FROM mes_work_orders
  WHERE NOT EXISTS(SELECT 1 FROM suite_migrations WHERE name='0003_mes_projection');
INSERT OR IGNORE INTO suite_migrations(name) VALUES ('0003_mes_projection');
''')
target=Path(__file__).resolve().parents[1]/'drizzle/0003_mes_projection.sql'
target.write_text('\n'.join(sql),encoding='utf-8')
print('Generated',target.name)
