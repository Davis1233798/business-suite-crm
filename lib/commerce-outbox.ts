import { and, eq, lt, sql } from "drizzle-orm";
import { getDb } from "../db/index";
import { outboxEvents } from "../db/schema";
import { infrastructureConfigured, infrastructureRequest } from "./infrastructure";

/** Concurrent dispatch is safe: consumers deduplicate by tenant + event ID. */
export async function dispatchCommerceOutbox() {
  if (!infrastructureConfigured()) return { configured: false, sent: 0 };
  const db = getDb();
  const rows = await db.select().from(outboxEvents).where(and(eq(outboxEvents.eventType, "shop.paid"), eq(outboxEvents.status, "pending"), lt(outboxEvents.retryCount, 10))).limit(25);
  let sent = 0;
  for (const event of rows) {
    try {
      const payload = JSON.parse(event.payload) as { orderId: string };
      await infrastructureRequest("/commerce/jobs", { method: "POST", body: JSON.stringify({ tenant: event.organizationId, event_id: event.id, order_id: payload.orderId }) });
      await db.update(outboxEvents).set({ status: "processed" }).where(eq(outboxEvents.id, event.id));
      sent++;
    } catch {
      await db.update(outboxEvents).set({ retryCount: sql`${outboxEvents.retryCount} + 1` }).where(and(eq(outboxEvents.id, event.id), eq(outboxEvents.status, "pending")));
    }
  }
  return { configured: true, sent };
}
