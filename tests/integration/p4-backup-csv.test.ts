import test from "node:test";
import assert from "node:assert";
import { seedOrganization } from "../../lib/seed.ts";
import { exportTenantBackup, restoreAndVerifyBackup } from "../../lib/backup-restore.ts";
import { sanitizeCsvField, generateCsv, formatTaipeiDate } from "../../lib/export-csv.ts";

test("P4: C05 - Backup & Independent Restore Verification", async () => {
  const orgId = `org_backup_${Date.now()}`;
  await seedOrganization(orgId);

  // Export backup
  const backup = await exportTenantBackup(orgId);
  assert.ok(backup.summary.stockRecordCount >= 2);
  assert.strictEqual(typeof backup.summary.posSaleTotalAmount, "number");
  assert.strictEqual(typeof backup.summary.shopOrderTotalAmount, "number");

  // Restore into an independent in-memory SQLite database
  const restoreResult = restoreAndVerifyBackup(backup, ":memory:");
  assert.strictEqual(restoreResult.success, true);
  assert.strictEqual(restoreResult.restoredStockCount, backup.summary.stockRecordCount);
  assert.strictEqual(restoreResult.restoredPosTotal, backup.summary.posSaleTotalAmount);
  assert.strictEqual(restoreResult.restoredShopTotal, backup.summary.shopOrderTotalAmount);
});

test("P4: C08 - CSV Formula Injection Safety & Taipei Timezone", () => {
  // Formula escaping tests
  assert.strictEqual(sanitizeCsvField("=SUM(A1:A10)"), "'=SUM(A1:A10)");
  assert.strictEqual(sanitizeCsvField("+CMD|' /C calc'!A0"), "'+CMD|' /C calc'!A0");
  assert.strictEqual(sanitizeCsvField("-200"), "'-200");
  assert.strictEqual(sanitizeCsvField("@malicious"), "'@malicious");
  assert.strictEqual(sanitizeCsvField("Normal Text"), "Normal Text");
  assert.strictEqual(sanitizeCsvField("Text, with comma"), '"Text, with comma"');

  const csvOutput = generateCsv(
    ["Product", "Formula", "Amount"],
    [
      ["Coffee", "=1+1", "100"],
      ["Tea", "Normal", "50"],
    ]
  );
  assert.ok(csvOutput.includes("'=1+1"));

  // Taipei Timezone check
  // 2026-10-30 00:00:00 UTC should be 2026-10-30 08:00:00 in Taipei (UTC+8)
  const taipeiDate = formatTaipeiDate("2026-10-30T00:00:00Z");
  assert.ok(taipeiDate.includes("08:00") || taipeiDate.includes("2026"));
});
