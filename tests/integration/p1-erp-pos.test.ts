import test from "node:test";
import assert from "node:assert";
import { getDb } from "../../db/index.ts";
import { seedOrganization } from "../../lib/seed.ts";
import { ErpService } from "../../lib/services/erp-service.ts";
import { PosService } from "../../lib/services/pos-service.ts";
import { erpPurchaseOrders, erpPurchaseOrderLines, erpStockLedger, posCatalogItems, posSales } from "../../db/schema.ts";
import { eq, and, sql } from "drizzle-orm";

test("P1 ERP Verification: E01 - E08", async () => {
  const orgId = `org_erp_test_${Date.now()}`;
  await seedOrganization(orgId);

  const adminCtx = {
    organizationId: orgId,
    userId: "usr_admin",
    userEmail: "admin@test.local",
    userDisplayName: "ERP Admin",
    role: "admin" as const,
    requestId: "req_erp_admin",
  };

  const operatorCtx = {
    ...adminCtx,
    userId: "usr_operator",
    role: "operator" as const,
    requestId: "req_erp_op",
  };

  // E01: 主檔/倉別/單位 (箱轉件倍率10)
  const itemRes = await ErpService.createItem(operatorCtx, {
    sku: "SKU-BEARING-BOX10",
    name: "精密微型軸承 10入盒裝",
    unit: "BOX",
    boxConversionRatio: 10,
  });
  assert.strictEqual(itemRes.boxConversionRatio, 10);

  // E02: 採購審核流程 (駁回需原因，未核准不得收貨)
  const db = getDb();
  const testPoId = `po_test_${Date.now()}`;
  await db.insert(erpPurchaseOrders).values({
    id: testPoId,
    organizationId: orgId,
    poNumber: "PO-TEST-001",
    supplierId: `erp_sup_01_${orgId}`,
    status: "draft",
    totalAmount: 1000,
  });
  const poLineId = `pol_test_${Date.now()}`;
  await db.insert(erpPurchaseOrderLines).values({
    id: poLineId,
    organizationId: orgId,
    poId: testPoId,
    itemId: itemRes.id,
    quantity: 10,
    unitPrice: 100,
    receivedQuantity: 0,
  });

  // Attempt receive on draft PO -> must reject (E02)
  await assert.rejects(
    async () => {
      await ErpService.receiveGoods(operatorCtx, {
        poId: testPoId,
        warehouseId: `erp_wh_01_${orgId}`,
        lines: [{ lineId: poLineId, quantity: 2, isBoxes: true }],
      });
    },
    /未核准的採購單不能收貨/
  );

  // Reject without reason -> must fail
  await assert.rejects(
    async () => {
      await ErpService.approvePurchaseOrder(adminCtx, testPoId, false);
    },
    /駁回必須填寫原因/
  );

  // Approve PO
  await ErpService.approvePurchaseOrder(adminCtx, testPoId, true);

  // E01 & E03: 收貨 1箱 (10件)
  const rcpt1 = await ErpService.receiveGoods(operatorCtx, {
    poId: testPoId,
    warehouseId: `erp_wh_01_${orgId}`,
    lines: [{ lineId: poLineId, quantity: 1, isBoxes: true }], // 1 box * 10 = 10 pieces
  });
  assert.strictEqual(rcpt1.success, true);

  // Attempt over-receiving: PO had quantity 10, now received 10. Receiving 1 more must reject (E03)
  await assert.rejects(
    async () => {
      await ErpService.receiveGoods(operatorCtx, {
        poId: testPoId,
        warehouseId: `erp_wh_01_${orgId}`,
        lines: [{ lineId: poLineId, quantity: 1, isBoxes: false }],
      });
    },
    /超收拒絕/
  );

  // E03: 退貨2件 -> 現有8件並產生反向紀錄
  const retRes = await ErpService.returnGoods(operatorCtx, {
    itemId: itemRes.id,
    warehouseId: `erp_wh_01_${orgId}`,
    quantity: 2,
    reason: "規格瑕疵退貨",
    referenceDoc: "RET-202610-001",
  });
  assert.strictEqual(retRes.balanceAfter, 8);

  // E04: 調撥 (總量守恆): 從倉1移3件到倉2
  const trRes = await ErpService.transferStock(operatorCtx, {
    itemId: itemRes.id,
    fromWarehouseId: `erp_wh_01_${orgId}`,
    toWarehouseId: `erp_wh_02_${orgId}`,
    quantity: 3,
  });
  assert.strictEqual(trRes.sourceBalanceAfter, 5); // 8 - 3 = 5
  assert.strictEqual(trRes.destBalanceAfter, 3); // 0 + 3 = 3
  assert.strictEqual(trRes.sourceBalanceAfter + trRes.destBalanceAfter, 8); // Total conserved!

  // E06: 應收應付 (發票1000收400，未收600；再收600結清；超收拒絕)
  const invId = `erp_inv_01_${orgId}`;
  // Attempt overpayment
  await assert.rejects(
    async () => {
      await ErpService.settleInvoicePayment(operatorCtx, {
        invoiceId: invId,
        amount: 700, // unpaid is 600
      });
    },
    /超收拒絕/
  );

  // Pay exactly 600
  const settleRes = await ErpService.settleInvoicePayment(operatorCtx, {
    invoiceId: invId,
    amount: 600,
  });
  assert.strictEqual(settleRes.unpaidAmount, 0);
  assert.strictEqual(settleRes.status, "paid");

  // E07: 總帳傳票 (借貸平衡；不平衡拒絕)
  await assert.rejects(
    async () => {
      await ErpService.createJournalEntry(operatorCtx, {
        entryDate: "2026-10-30",
        description: "不平衡傳票測試",
        lines: [
          { accountCode: "1101", accountName: "銀行存款", debitAmount: 1000, creditAmount: 0 },
          { accountCode: "2101", accountName: "應付帳款", debitAmount: 0, creditAmount: 900 },
        ],
      });
    },
    /傳票借貸不平衡/
  );

  const balancedJe = await ErpService.createJournalEntry(operatorCtx, {
    entryDate: "2026-10-30",
    description: "平衡傳票測試",
    lines: [
      { accountCode: "1101", accountName: "銀行存款", debitAmount: 5000, creditAmount: 0 },
      { accountCode: "2101", accountName: "應付帳款", debitAmount: 0, creditAmount: 5000 },
    ],
  });
  assert.strictEqual(balancedJe.success, true);

  // E08: 試算表檢驗
  const tb = await ErpService.getTrialBalance(operatorCtx);
  assert.strictEqual(tb.isBalanced, true);
  assert.strictEqual(tb.grandDebit, tb.grandCredit);
});

test("P1 POS Verification: P01 - P08", async () => {
  const orgId = `org_pos_test_${Date.now()}`;
  await seedOrganization(orgId);

  const adminCtx = {
    organizationId: orgId,
    userId: "usr_admin",
    userEmail: "admin@test.local",
    userDisplayName: "Store Manager",
    role: "admin" as const,
    requestId: "req_pos_admin",
  };

  const operatorCtx = {
    ...adminCtx,
    userId: "usr_cashier",
    role: "operator" as const,
    requestId: "req_pos_cashier",
  };

  const db = getDb();
  const storeId = `pos_store_01_${orgId}`;
  const regId = `pos_reg_01_${orgId}`;
  const shiftId = `pos_shift_01_${orgId}`;

  // P01: 掃描條碼取服務端價格
  const item = await PosService.scanBarcode(operatorCtx, "4710001001");
  assert.strictEqual(item.price, 100);

  // P02 & P03: 商品100x2，折10後190；付200找10
  const checkoutRes: any = await PosService.checkout(operatorCtx, {
    storeId,
    registerId: regId,
    shiftId,
    items: [{ barcode: "4710001001", quantity: 2, lineDiscount: 10 }],
    tenderAmount: 200,
    paymentMethod: "cash",
    idempotencyKey: "pos_idem_001",
  });

  assert.strictEqual(checkoutRes.subtotal, 200);
  assert.strictEqual(checkoutRes.discountAmount, 10);
  assert.strictEqual(checkoutRes.totalAmount, 190);
  assert.strictEqual(checkoutRes.changeAmount, 10);

  // Duplicate idempotency test (P03 / C06)
  const dupCheckoutRes: any = await PosService.checkout(operatorCtx, {
    storeId,
    registerId: regId,
    shiftId,
    items: [{ barcode: "4710001001", quantity: 2, lineDiscount: 10 }],
    tenderAmount: 200,
    paymentMethod: "cash",
    idempotencyKey: "pos_idem_001",
  });
  assert.ok(dupCheckoutRes);

  // P04: 掛單與跨工作站取單
  const held = await PosService.holdCart(operatorCtx, {
    storeId,
    cartName: "VIP客戶掛單A",
    items: [{ barcode: "4710001001", quantity: 1 }],
  });
  assert.ok(held.cartId);

  const retrieved = await PosService.retrieveCart(operatorCtx, held.cartId, "REG-02");
  assert.strictEqual(retrieved.cartName, "VIP客戶掛單A");

  // Attempt second retrieve -> must fail (P04)
  await assert.rejects(
    async () => {
      await PosService.retrieveCart(operatorCtx, held.cartId, "REG-03");
    },
    /已被其他工作站取走/
  );

  // P05: 退貨/退款 (需店長權限，分攤退款，超退拒絕)
  const saleList = await db.select().from(posSales)
    .where(and(eq(posSales.organizationId, orgId), eq(posSales.totalAmount, 190)))
    .limit(1);
  assert.strictEqual(saleList.length, 1);
  const sale = saleList[0];

  const lines = await PosService.reprintReceipt(operatorCtx, sale.receiptNumber);
  const saleLine = lines.lines[0];

  // Cashier attempt refund -> must fail (needs manager)
  await assert.rejects(
    async () => {
      await PosService.refundSale(operatorCtx, {
        saleId: sale.id,
        lineReturns: [{ lineId: saleLine.id, quantity: 1 }],
        reason: "客人不需要",
      });
    },
    /退款必須具有店長或管理員權限/
  );

  // Manager refunds 1 piece (original 2 pieces for 190 -> 95 per piece)
  const refundRes = await PosService.refundSale(adminCtx, {
    saleId: sale.id,
    lineReturns: [{ lineId: saleLine.id, quantity: 1 }],
    reason: "客人換貨退款",
  });
  assert.strictEqual(refundRes.totalRefundAmount, 95);

  // Cumulative over-refund attempt -> must reject (P05)
  await assert.rejects(
    async () => {
      await PosService.refundSale(adminCtx, {
        saleId: sale.id,
        lineReturns: [{ lineId: saleLine.id, quantity: 2 }], // only 1 left refundable
        reason: "多退",
      });
    },
    /累計超退拒絕/
  );

  // P06: 交班現金盤點 (開班1000 + 現金銷售190 - 退款95 = 1095)
  // Let's close with 1085 (discrepancy -10), must require notes!
  await assert.rejects(
    async () => {
      await PosService.closeShift(operatorCtx, {
        shiftId,
        closingCash: 1085,
      });
    },
    /結班必須填寫說明/
  );

  const closeRes = await PosService.closeShift(operatorCtx, {
    shiftId,
    closingCash: 1085,
    notes: "找零硬幣微幅短少10元",
  });
  assert.strictEqual(closeRes.discrepancy, -10);

  // P07: 小票重印標記
  const reprint = await PosService.reprintReceipt(operatorCtx, sale.receiptNumber);
  assert.strictEqual(reprint.isReprint, true);

  // P08: 日報 (Net = Sales - Refunds)
  const report = await PosService.getDailyReport(operatorCtx, storeId);
  assert.strictEqual(report.grossSales >= 190, true);
  assert.strictEqual(report.totalRefunds >= 95, true);
  assert.strictEqual(report.netSales, report.grossSales - report.totalRefunds);
});
