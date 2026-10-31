import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { resolveTenantContext } from "../../lib/tenant";
import { getDb, runWithDatabase } from "../../db";
import { createSqliteD1 } from "../../lib/db/sqlite-d1";
import { seedOrganization } from "../../lib/seed";
import { PosService } from "../../lib/services/pos-service";
import { posCatalogItems, posSales, organizations } from "../../db/schema";
import { eq } from "drizzle-orm";

test("Tenant sandbox ignores forged organization, user and admin headers", () => {
  const session = crypto.randomUUID();
  const request = new NextRequest("https://example.test/api/pos/data", { headers: { cookie: `demo_session_id=${session}; demo_user_role=readonly`, "x-organization-id": "victim", "x-user-id": "victim", "x-user-role": "admin" } });
  const context = resolveTenantContext(request);
  assert.equal(context.organizationId, `org_${session}`);
  assert.equal(context.role, "readonly");
  assert.notEqual(context.userId, "victim");
  assert.throws(() => resolveTenantContext(new NextRequest("https://example.test/api/pos/data")));
});

test("Request-scoped D1 bindings cannot leak between concurrent requests", async () => {
  const a = createSqliteD1(); const b = createSqliteD1();
  await Promise.all([
    runWithDatabase(a, async () => { await Promise.resolve(); await getDb().insert(organizations).values({ id: "a", name: "A", slug: "a" }); }),
    runWithDatabase(b, async () => { await Promise.resolve(); await getDb().insert(organizations).values({ id: "b", name: "B", slug: "b" }); }),
  ]);
  assert.equal((await runWithDatabase(a, () => getDb().select().from(organizations)))[0].id, "a");
  assert.equal((await runWithDatabase(b, () => getDb().select().from(organizations)))[0].id, "b");
});

test("POS concurrent last-item checkout rolls losing transaction back", async () => {
  const org = `org_race_${crypto.randomUUID()}`;
  await seedOrganization(org);
  const context = { organizationId: org, userId: "tester", userEmail: "test@example.test", userDisplayName: "Test", role: "admin" as const, requestId: crypto.randomUUID() };
  const db = getDb();
  const [item] = await db.select().from(posCatalogItems).where(eq(posCatalogItems.organizationId, org));
  await db.update(posCatalogItems).set({ stockQuantity: 1 }).where(eq(posCatalogItems.id, item.id));
  const params = { storeId: `pos_store_01_${org}`, registerId: `pos_reg_01_${org}`, shiftId: `pos_shift_01_${org}`, items: [{ barcode: item.barcode, quantity: 1 }], tenderAmount: item.price };
  const results = await Promise.allSettled([PosService.checkout(context, { ...params, idempotencyKey: "one" }), PosService.checkout(context, { ...params, idempotencyKey: "two" })]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal((await db.select().from(posCatalogItems).where(eq(posCatalogItems.id, item.id)))[0].stockQuantity, 0);
  assert.equal((await db.select().from(posSales).where(eq(posSales.organizationId, org))).length, 1);
});

test("POS concurrent identical idempotency keys return one sale and same receipt", async () => {
  const org = `org_retry_${crypto.randomUUID()}`;
  await seedOrganization(org);
  const context = { organizationId: org, userId: "tester", userEmail: "test@example.test", userDisplayName: "Test", role: "admin" as const, requestId: crypto.randomUUID() };
  const db = getDb();
  const [item] = await db.select().from(posCatalogItems).where(eq(posCatalogItems.organizationId, org));
  const params = { storeId: `pos_store_01_${org}`, registerId: `pos_reg_01_${org}`, shiftId: `pos_shift_01_${org}`, items: [{ barcode: item.barcode, quantity: 1 }], tenderAmount: item.price, idempotencyKey: "same-key" };
  const [first, second] = await Promise.all([PosService.checkout(context, params), PosService.checkout(context, params)]);
  assert.equal(first.saleId, second.saleId);
  assert.equal((await db.select().from(posSales).where(eq(posSales.organizationId, org))).length, 1);
});
