import test from "node:test";
import assert from "node:assert";
import { getDb } from "../../db/index.ts";
import { organizations, users, memberships, auditEvents, idempotencyKeys, erpItems } from "../../db/schema.ts";
import { seedOrganization } from "../../lib/seed.ts";
import { resolveTenantContext, checkPermission } from "../../lib/tenant.ts";
import { recordAuditEvent } from "../../lib/audit.ts";
import { checkIdempotency, saveIdempotency } from "../../lib/idempotency.ts";
import { eq, and } from "drizzle-orm";

test("P0 Core: C01 - Identity and Role Permissions", async () => {
  const adminCtx = {
    organizationId: "org_test_c01",
    userId: "usr_admin",
    userEmail: "admin@test.local",
    userDisplayName: "Admin",
    role: "admin" as const,
    requestId: "req_c01_1",
  };
  const operatorCtx = {
    ...adminCtx,
    role: "operator" as const,
    userId: "usr_op",
  };
  const readonlyCtx = {
    ...adminCtx,
    role: "readonly" as const,
    userId: "usr_ro",
  };

  // 1. Admin allowed for admin operations
  assert.strictEqual(checkPermission(adminCtx, "admin").allowed, true);
  // 2. Operator allowed for operator operations, but denied for admin-only operations
  assert.strictEqual(checkPermission(operatorCtx, "operator").allowed, true);
  const opAdminCheck = checkPermission(operatorCtx, "admin");
  assert.strictEqual(opAdminCheck.allowed, false);
  assert.strictEqual(opAdminCheck.code, "FORBIDDEN_ADMIN_REQUIRED");

  // 3. Readonly denied for any modification
  const roCheck = checkPermission(readonlyCtx, "operator");
  assert.strictEqual(roCheck.allowed, false);
  assert.strictEqual(roCheck.code, "FORBIDDEN_READONLY");
});

test("P0 Core: C02 - Multi-tenant Isolation", async () => {
  const db = getDb();
  const orgA = "org_iso_a";
  const orgB = "org_iso_b";

  await seedOrganization(orgA);
  await seedOrganization(orgB);

  // Add a unique item to Org A
  const itemAId = `item_unique_a_${Date.now()}`;
  await db.insert(erpItems).values({
    id: itemAId,
    organizationId: orgA,
    sku: "SKU-ISOLATED-A",
    name: "隔離測試商品 A",
    unit: "PCS",
    boxConversionRatio: 1,
    category: "TEST",
    isActive: true,
  });

  // Query as Org B using Org A's ID
  const queryFromB = await db
    .select()
    .from(erpItems)
    .where(and(eq(erpItems.organizationId, orgB), eq(erpItems.id, itemAId)));

  assert.strictEqual(queryFromB.length, 0, "Org B should never see Org A data!");

  // Query as Org A
  const queryFromA = await db
    .select()
    .from(erpItems)
    .where(and(eq(erpItems.organizationId, orgA), eq(erpItems.id, itemAId)));

  assert.strictEqual(queryFromA.length, 1, "Org A should see its own data.");
});

test("P0 Core: C03 - Audit Logging", async () => {
  const db = getDb();
  const orgId = "org_audit_test";
  const context = {
    organizationId: orgId,
    userId: "usr_audit_actor",
    userEmail: "actor@test.local",
    userDisplayName: "Audit Tester",
    role: "admin" as const,
    requestId: "req_audit_001",
  };

  const auditId = await recordAuditEvent({
    context,
    action: "UPDATE_AMOUNT",
    entityType: "ERP_INVOICE",
    entityId: "INV-TEST-01",
    beforeValue: { amount: 1000 },
    afterValue: { amount: 1500 },
    reason: "客戶追加訂單變更金額",
  });

  assert.ok(auditId, "Audit event ID must be generated");

  const records = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.id, auditId));

  assert.strictEqual(records.length, 1);
  const rec = records[0];
  assert.strictEqual(rec.action, "UPDATE_AMOUNT");
  assert.strictEqual(rec.actorId, "usr_audit_actor");
  assert.strictEqual(rec.requestId, "req_audit_001");
  assert.strictEqual(rec.reason, "客戶追加訂單變更金額");
  assert.deepStrictEqual(JSON.parse(rec.beforeValue!), { amount: 1000 });
  assert.deepStrictEqual(JSON.parse(rec.afterValue!), { amount: 1500 });
});

test("P0 Core: C06 - Idempotency Replay", async () => {
  const db = getDb();
  const orgId = "org_idem_test";
  const context = {
    organizationId: orgId,
    userId: "usr_idem",
    userEmail: "idem@test.local",
    userDisplayName: "Idempotent User",
    role: "operator" as const,
    requestId: "req_idem_1",
  };

  const idempotencyKey = `key_${Date.now()}`;
  const endpoint = "/api/pos/checkout";

  // First check: not processed yet
  const firstCheck = await checkIdempotency(context, idempotencyKey, endpoint);
  assert.strictEqual(firstCheck.isDuplicate, false);

  // Save successful response
  const responseData = { success: true, saleId: "SALE-001", totalAmount: 190 };
  await saveIdempotency(context, idempotencyKey, endpoint, 200, responseData);

  // Send duplicate 1
  const duplicate1 = await checkIdempotency(context, idempotencyKey, endpoint);
  assert.strictEqual(duplicate1.isDuplicate, true);

  // Send duplicate 2
  const duplicate2 = await checkIdempotency(context, idempotencyKey, endpoint);
  assert.strictEqual(duplicate2.isDuplicate, true);

  // Verify only 1 record exists in DB
  const records = await db
    .select()
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.organizationId, orgId),
        eq(idempotencyKeys.key, idempotencyKey)
      )
    );
  assert.strictEqual(records.length, 1, "Idempotency key must only exist once");
});
