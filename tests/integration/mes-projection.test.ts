import test from 'node:test';
import assert from 'node:assert/strict';
import {and,eq} from 'drizzle-orm';
import {getDb} from '../../db/index';
import {mesWorkOrders,outboxEvents} from '../../db/schema';
import {seedOrganization} from '../../lib/seed';
import {loadMesProjection} from '../../lib/mes-projection';
import {MesService} from '../../lib/services/mes-service';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

test('MES migration backfills existing orders once and installs ongoing change capture',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    db.exec(readFileSync('drizzle/0000_spicy_bromley.sql','utf8'));
    db.exec("INSERT INTO mes_work_orders(id,organization_id,order_no,product_id,bom_version_id,target_quantity) VALUES ('existing','factory','WO-OLD','product','bom',10)");
    const migration=readFileSync('drizzle/0003_mes_projection.sql','utf8');
    db.exec(migration);
    assert.equal(db.prepare('SELECT count(*) AS n FROM outbox_events').get()?.n,1);
    db.exec(migration);
    assert.equal(db.prepare('SELECT count(*) AS n FROM outbox_events').get()?.n,1);
    db.exec("UPDATE mes_work_orders SET status='released' WHERE id='existing'");
    assert.equal(db.prepare('SELECT revision FROM mes_projection_revisions').get()?.revision,2);
    assert.equal(db.prepare('SELECT count(*) AS n FROM outbox_events').get()?.n,2);
  } finally {db.close();}
});

test('MES mutations atomically enqueue versioned projections; deleted and recreated IDs cannot regress', async()=>{
  const tenant='mes_projection_'+crypto.randomUUID();
  await seedOrganization(tenant);
  const db=getDb();
  const [order]=await db.select().from(mesWorkOrders).where(eq(mesWorkOrders.organizationId,tenant));
  await MesService.startWorkOrder({organizationId:tenant,userId:'operator',userEmail:'operator@test.local',userDisplayName:'Operator',role:'admin',requestId:crypto.randomUUID()},order.id);
  const events=()=>db.select().from(outboxEvents).where(and(eq(outboxEvents.organizationId,tenant),eq(outboxEvents.eventType,'mes.work-order.changed')));
  assert.ok((await events()).length>0);
  const first=await loadMesProjection(tenant,order.id);
  await db.update(mesWorkOrders).set({completedQuantity:order.completedQuantity+1}).where(eq(mesWorkOrders.id,order.id));
  const changed=await loadMesProjection(tenant,order.id);
  assert.ok(changed.revision>first.revision);
  assert.equal(changed.order?.completedQuantity,order.completedQuantity+1);
  const before=(await events()).length;
  await assert.rejects(()=>db.batch([
    db.update(mesWorkOrders).set({status:'in_progress'}).where(eq(mesWorkOrders.id,order.id)),
    db.insert(mesWorkOrders).values(order),
  ]));
  assert.equal((await events()).length,before);
  assert.equal((await loadMesProjection(tenant,order.id)).revision,changed.revision);
  await db.delete(mesWorkOrders).where(eq(mesWorkOrders.id,order.id));
  const removed=await loadMesProjection(tenant,order.id);
  assert.equal(removed.deleted,true);
  assert.ok(removed.revision>changed.revision);
  await db.insert(mesWorkOrders).values(order);
  assert.ok((await loadMesProjection(tenant,order.id)).revision>removed.revision);
  assert.equal((await loadMesProjection('other-tenant',order.id)).revision,0);
});
