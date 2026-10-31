import { eq, and, sql } from "drizzle-orm";
import { getDb } from "../../db";
import * as t from "../../db/schema";
import { TenantContext, checkPermission } from "../tenant";
import { ErpService } from "./erp-service";

export class ErpAdvancedService {
  static async partner(context: TenantContext, input: { kind: "supplier" | "customer"; code: string; name: string; contactEmail?: string }) {
    if (!checkPermission(context, "operator").allowed) throw new Error("403 Forbidden");
    const table = input.kind === "supplier" ? t.erpSuppliers : t.erpCustomers;
    const db = getDb();
    const [existing] = await db.select().from(table).where(and(eq(table.organizationId, context.organizationId), eq(table.code, input.code)));
    if (existing) throw new Error("代碼已存在");
    const id = crypto.randomUUID();
    await db.insert(table).values({ id, organizationId: context.organizationId, code: input.code, name: input.name, contactEmail: input.contactEmail || null });
    return { id, message: "主檔已建立" };
  }
  static async invoice(context: TenantContext, input: { kind: "payable" | "receivable"; orderId: string; dueDate?: string }) {
    if (!checkPermission(context, "operator").allowed) throw new Error("403 Forbidden");
    const db = getDb();
    const payable = input.kind === "payable";
    const table = payable ? t.erpPurchaseOrders : t.erpSalesOrders;
    const [order] = await db.select().from(table).where(and(eq(table.organizationId, context.organizationId), eq(table.id, input.orderId)));
    if (!order) throw new Error("來源訂單不存在");
    const lines = payable
      ? await db.select().from(t.erpPurchaseOrderLines).where(and(eq(t.erpPurchaseOrderLines.organizationId, context.organizationId), eq(t.erpPurchaseOrderLines.poId, order.id)))
      : await db.select().from(t.erpSalesOrderLines).where(and(eq(t.erpSalesOrderLines.organizationId, context.organizationId), eq(t.erpSalesOrderLines.soId, order.id)));
    if (!lines.length || lines.some(line => (payable ? (line as any).receivedQuantity : (line as any).shippedQuantity) !== line.quantity)) throw new Error("請先完成所有收貨或出貨，才能建立整單帳單");
    const totalAmount = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
    if (totalAmount <= 0) throw new Error("帳單金額必須大於零");
    // Deterministic primary key makes simultaneous duplicate invoices impossible.
    const id = `invoice_${input.kind}_${order.id}`;
    const existing = await db.select().from(t.erpInvoices).where(eq(t.erpInvoices.id, id));
    if (existing.length) throw new Error("此訂單已建立帳單");
    const invoiceNumber = `${payable ? "AP" : "AR"}-${payable ? (order as any).poNumber : (order as any).soNumber}`;
    await db.batch([
      db.insert(t.erpInvoices).values({ id, organizationId: context.organizationId, invoiceNumber, invoiceType: input.kind, partnerType: payable ? "supplier" : "customer", partnerId: payable ? (order as any).supplierId : (order as any).customerId, totalAmount, dueDate: input.dueDate || null }),
      db.insert(t.auditEvents).values({ id: crypto.randomUUID(), organizationId: context.organizationId, actorId: context.userId, actorRole: context.role, action: "CREATE_LINKED_INVOICE", entityType: "ERP_INVOICE", entityId: id, afterValue: JSON.stringify({ orderId: order.id, totalAmount }), reason: "根據完成收貨或出貨的訂單產生內部帳單（非電子發票）", requestId: context.requestId }),
    ]);
    return { id, invoiceNumber, totalAmount, message: "內部帳單已建立，可在上方應收應付清單核銷" };
  }
  static async count(context: TenantContext, input: { itemId: string; warehouseId: string; expectedQuantity: number; countedQuantity: number; reason: string; approved: true }) {
    if (!checkPermission(context, "admin").allowed) throw new Error("403 Forbidden");
    const db = getDb();
    const [item] = await db.select().from(t.erpItems).where(and(eq(t.erpItems.organizationId, context.organizationId), eq(t.erpItems.id, input.itemId)));
    const [warehouse] = await db.select().from(t.erpWarehouses).where(and(eq(t.erpWarehouses.organizationId, context.organizationId), eq(t.erpWarehouses.id, input.warehouseId)));
    if (!item || !warehouse) throw new Error("品項或倉庫不存在");
    const [last] = await db.select().from(t.erpStockLedger).where(and(eq(t.erpStockLedger.organizationId, context.organizationId), eq(t.erpStockLedger.itemId, item.id), eq(t.erpStockLedger.warehouseId, warehouse.id))).orderBy(sql`rowid DESC`).limit(1);
    const previous = last?.balanceAfter || 0;
    if (previous !== input.expectedQuantity) throw new Error("庫存已變動，請重新整理後再核准盤點");
    const delta = input.countedQuantity - previous;
    if (!delta) throw new Error("盤點數量相同，無須調整");
    const unitCost = last?.unitCost || 0;
    const referenceDoc = `COUNT-${crypto.randomUUID()}`;
    await db.batch([
      db.insert(t.erpStockLedger).values({ id: crypto.randomUUID(), organizationId: context.organizationId, itemId: item.id, warehouseId: warehouse.id, changeType: "adjustment", quantityChange: delta, balanceAfter: input.countedQuantity, unitCost, totalValue: delta * unitCost, referenceDoc }),
      db.insert(t.auditEvents).values({ id: crypto.randomUUID(), organizationId: context.organizationId, actorId: context.userId, actorRole: context.role, action: "APPROVE_STOCK_COUNT", entityType: "ERP_STOCK", entityId: referenceDoc, beforeValue: JSON.stringify({ quantity: previous }), afterValue: JSON.stringify({ quantity: input.countedQuantity, delta }), reason: input.reason, requestId: context.requestId }),
    ]);
    return { referenceDoc, balanceAfter: input.countedQuantity, delta, message: "管理員盤點核准已過帳" };
  }
  static async supplierReturn(context: TenantContext, input: { receiptLineId: string; quantity: number; reason: string }) {
    if (!checkPermission(context, "operator").allowed) throw new Error("403 Forbidden");
    const db = getDb();
    const [line] = await db.select().from(t.erpReceiptLines).where(and(eq(t.erpReceiptLines.organizationId, context.organizationId), eq(t.erpReceiptLines.id, input.receiptLineId)));
    if (!line) throw new Error("收貨明細不存在");
    const [receipt] = await db.select().from(t.erpReceipts).where(and(eq(t.erpReceipts.organizationId, context.organizationId), eq(t.erpReceipts.id, line.receiptId)));
    if (!receipt) throw new Error("收貨單不存在");
    const referenceDoc = `RETURN:${line.id}`;
    const previousReturns = await db.select().from(t.erpStockLedger).where(and(eq(t.erpStockLedger.organizationId, context.organizationId), eq(t.erpStockLedger.referenceDoc, referenceDoc)));
    const returned = previousReturns.reduce((sum, entry) => sum - entry.quantityChange, 0);
    if (input.quantity > line.quantity - returned) throw new Error("累計退貨不能超過原收貨數量");
    return ErpService.returnGoods(context, { itemId: line.itemId, warehouseId: receipt.warehouseId, quantity: input.quantity, reason: input.reason, referenceDoc });
  }
  static async closePeriod(context: TenantContext, periodId: string) {
    if (!checkPermission(context, "admin").allowed) throw new Error("403 Forbidden");
    const db = getDb();
    const [period] = await db.select().from(t.erpFiscalPeriods).where(and(eq(t.erpFiscalPeriods.organizationId, context.organizationId), eq(t.erpFiscalPeriods.id, periodId)));
    if (!period || period.isClosed) throw new Error("期間不存在或已關帳");
    const balance = await ErpService.getTrialBalance(context);
    if (!balance.isBalanced) throw new Error("借貸不平衡，不可關帳");
    await db.batch([
      db.update(t.erpFiscalPeriods).set({ isClosed: true }).where(and(eq(t.erpFiscalPeriods.organizationId, context.organizationId), eq(t.erpFiscalPeriods.id, periodId))),
      db.insert(t.auditEvents).values({ id: crypto.randomUUID(), organizationId: context.organizationId, actorId: context.userId, actorRole: context.role, action: "CLOSE_FISCAL_PERIOD", entityType: "ERP_PERIOD", entityId: periodId, beforeValue: JSON.stringify({ isClosed: false }), afterValue: JSON.stringify({ isClosed: true }), reason: "管理員確認試算表平衡後關帳", requestId: context.requestId }),
    ]);
    return { message: `${period.periodCode} 已關帳` };
  }
}
