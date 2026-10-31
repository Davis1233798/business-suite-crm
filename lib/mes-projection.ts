import {and,eq,inArray,lt,asc,sql} from "drizzle-orm";
import {sqliteTable,text,integer,primaryKey} from "drizzle-orm/sqlite-core";
import {getDb} from "../db/index";
import {mesWorkOrders,mesOperations,mesQualityChecks,outboxEvents} from "../db/schema";
import {infrastructureConfigured,infrastructureRequest} from "./infrastructure";

// Internal revision metadata intentionally stays outside the business backup/reset table registry.
const revisions=sqliteTable("mes_projection_revisions",{
  organizationId:text("organization_id").notNull(),workOrderId:text("work_order_id").notNull(),revision:integer("revision").notNull(),
},table=>[primaryKey({columns:[table.organizationId,table.workOrderId]})]);

export async function loadMesProjection(tenant:string,id:string) {
  const db=getDb();
  const [[version],orders,[quality],[operations]]=await db.batch([
    db.select().from(revisions).where(and(eq(revisions.organizationId,tenant),eq(revisions.workOrderId,id))),
    db.select().from(mesWorkOrders).where(and(eq(mesWorkOrders.organizationId,tenant),eq(mesWorkOrders.id,id))),
    db.select({checks:sql<number>`count(*)`,failedQuantity:sql<number>`coalesce(sum(${mesQualityChecks.failedQuantity}),0)`}).from(mesQualityChecks).where(and(eq(mesQualityChecks.organizationId,tenant),eq(mesQualityChecks.workOrderId,id))),
    db.select({total:sql<number>`count(*)`,completed:sql<number>`coalesce(sum(case when ${mesOperations.status} = 'completed' then 1 else 0 end),0)`}).from(mesOperations).where(and(eq(mesOperations.organizationId,tenant),eq(mesOperations.workOrderId,id))),
  ]);
  return {revision:version?.revision??0,deleted:orders.length===0,order:orders[0]??null,quality,operations};
}

/** Repeated/out-of-order delivery is resolved by the PostgreSQL revision compare. */
export async function dispatchMesProjections() {
  if (!infrastructureConfigured()) return {configured:false,sent:0};
  const db=getDb();
  const rows=await db.select().from(outboxEvents).where(and(eq(outboxEvents.eventType,"mes.work-order.changed"),eq(outboxEvents.status,"pending"),lt(outboxEvents.retryCount,10))).orderBy(asc(outboxEvents.createdAt),asc(outboxEvents.id)).limit(100);
  const groups=new Map<string,{tenant:string;id:string;events:string[]}>();
  for (const row of rows) {
    const payload=JSON.parse(row.payload) as {workOrderId:string};
    const key=JSON.stringify([row.organizationId,payload.workOrderId]);
    const group=groups.get(key)??{tenant:row.organizationId,id:payload.workOrderId,events:[]};
    group.events.push(row.id);groups.set(key,group);
  }
  let sent=0;
  for (const group of groups.values()) {
    try {
      const snapshot=await loadMesProjection(group.tenant,group.id);
      await infrastructureRequest(`/mes/${encodeURIComponent(group.tenant)}/work-orders/${encodeURIComponent(group.id)}`,{method:"PUT",body:JSON.stringify(snapshot)});
      await db.update(outboxEvents).set({status:"processed"}).where(and(inArray(outboxEvents.id,group.events),eq(outboxEvents.status,"pending")));
      sent+=group.events.length;
    } catch {
      await db.update(outboxEvents).set({retryCount:sql`${outboxEvents.retryCount}+1`}).where(and(inArray(outboxEvents.id,group.events),eq(outboxEvents.status,"pending")));
    }
  }
  return {configured:true,sent};
}
