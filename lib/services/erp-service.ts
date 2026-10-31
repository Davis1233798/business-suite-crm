import { eq, and, sql } from "drizzle-orm";
import { getDb } from "../../db/index";
import {
  erpItems,
  erpWarehouses,
  erpPurchaseOrders,
  erpPurchaseOrderLines,
  erpReceipts,
  erpReceiptLines,
  erpSalesOrders,
  erpSalesOrderLines,
  erpShipments,
  erpShipmentLines,
  erpStockLedger,
  erpItemCosting,
  erpInvoices,
  erpPayments,
  erpJournalEntries,
  erpJournalLines,
  erpFiscalPeriods,
} from "../../db/schema";
import { TenantContext, checkPermission } from "../tenant";
import { recordAuditEvent } from "../audit";
import { calculateMovingAverage } from "../money";

export class ErpService {
  /**
   * E01: Add item with box conversion ratio
   */
  static async createItem(context: TenantContext, params: {
    sku: string;
    name: string;
    unit?: string;
    boxConversionRatio?: number;
    category?: string;
  }) {
    const perm = checkPermission(context, "operator");
    if (!perm.allowed) throw new Error(perm.message);

    const db = getDb();
    const id = `item_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const ratio = Math.max(1, params.boxConversionRatio || 1);

    await db.insert(erpItems).values({
      id,
      organizationId: context.organizationId,
      sku: params.sku,
      name: params.name,
      unit: params.unit || "PCS",
      boxConversionRatio: ratio,
      category: params.category || "general",
      isActive: true,
    });

    return { id, sku: params.sku, boxConversionRatio: ratio };
  }

  /**
   * E02: Approve Purchase Order
   */
  static async approvePurchaseOrder(context: TenantContext, poId: string, approved: boolean, reason?: string) {
    const perm = checkPermission(context, "admin");
    if (!perm.allowed) throw new Error(perm.message);

    const db = getDb();
    const po = await db.select().from(erpPurchaseOrders)
      .where(and(eq(erpPurchaseOrders.organizationId, context.organizationId), eq(erpPurchaseOrders.id, poId)))
      .limit(1);

    if (po.length === 0) throw new Error("採購單不存在");
    const current = po[0];

    if (!approved && !reason) {
      throw new Error("駁回必須填寫原因");
    }

    const newStatus = approved ? "approved" : "rejected";
    await db.update(erpPurchaseOrders)
      .set({ status: newStatus, rejectedReason: reason || null })
      .where(eq(erpPurchaseOrders.id, poId));

    await recordAuditEvent({
      context,
      action: approved ? "APPROVE_PO" : "REJECT_PO",
      entityType: "ERP_PO",
      entityId: poId,
      beforeValue: { status: current.status },
      afterValue: { status: newStatus, reason },
      reason,
    });

    return { success: true, status: newStatus };
  }

  /**
   * E03: Receive goods from approved PO with anti-over-receiving
   */
  static async receiveGoods(context: TenantContext, params: {
    poId: string;
    warehouseId: string;
    lines: Array<{ lineId: string; quantity: number; isBoxes?: boolean }>;
  }) {
    const perm = checkPermission(context, "operator");
    if (!perm.allowed) throw new Error(perm.message);

    const db = getDb();
    const queries: any[] = [];
    const poList = await db.select().from(erpPurchaseOrders)
      .where(and(eq(erpPurchaseOrders.organizationId, context.organizationId), eq(erpPurchaseOrders.id, params.poId)))
      .limit(1);

    if (poList.length === 0) throw new Error("採購單不存在");
    if (poList[0].status !== "approved") {
      throw new Error("未核准的採購單不能收貨 (E02)");
    }

    if (!params.lines.length || new Set(params.lines.map(line => line.lineId)).size !== params.lines.length) throw new Error("收貨明細不可為空或重複");
    const warehouse = await db.select().from(erpWarehouses).where(and(eq(erpWarehouses.id, params.warehouseId), eq(erpWarehouses.organizationId, context.organizationId))).limit(1);
    if (!warehouse.length) throw new Error("倉庫不存在");
    const receiptId = `rcpt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const receiptNumber = `RC-${Date.now()}`;

    queries.push(db.insert(erpReceipts).values({
      id: receiptId,
      organizationId: context.organizationId,
      receiptNumber,
      poId: params.poId,
      warehouseId: params.warehouseId,
      status: "completed",
    }));

    for (const line of params.lines) {
      const pol = await db.select().from(erpPurchaseOrderLines)
        .where(and(eq(erpPurchaseOrderLines.organizationId, context.organizationId), eq(erpPurchaseOrderLines.poId, params.poId), eq(erpPurchaseOrderLines.id, line.lineId)))
        .limit(1);

      if (pol.length === 0) throw new Error(`採購單明細 ${line.lineId} 不存在`);
      const poLine = pol[0];

      const itemRes = await db.select().from(erpItems)
        .where(eq(erpItems.id, poLine.itemId))
        .limit(1);
      const conversionRatio = itemRes[0]?.boxConversionRatio || 1;

      // Actual received pieces (e.g. 2 boxes * 10 = 20 pieces)
      const receivedPieces = line.isBoxes ? line.quantity * conversionRatio : line.quantity;
      if (!Number.isSafeInteger(receivedPieces) || receivedPieces <= 0) throw new Error("收貨數量必須是正整數");

      const remainingAllowed = poLine.quantity - poLine.receivedQuantity;
      if (receivedPieces > remainingAllowed) {
        throw new Error(`超收拒絕！採購訂量 ${poLine.quantity}，已收 ${poLine.receivedQuantity}，本次欲收 ${receivedPieces}，超過未收量 ${remainingAllowed} (E03)`);
      }

      // Update received quantity
      const newReceived = poLine.receivedQuantity + receivedPieces;
      queries.push(db.update(erpPurchaseOrderLines)
        .set({ receivedQuantity: newReceived })
        .where(eq(erpPurchaseOrderLines.id, line.lineId)));

      // Receipt line
      queries.push(db.insert(erpReceiptLines).values({
        id: `rcl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        organizationId: context.organizationId,
        receiptId,
        itemId: poLine.itemId,
        quantity: receivedPieces,
        unitCost: poLine.unitPrice,
      }));

      // Stock Ledger
      const currentBalanceRes = await db.select().from(erpStockLedger)
        .where(and(eq(erpStockLedger.organizationId, context.organizationId), eq(erpStockLedger.itemId, poLine.itemId), eq(erpStockLedger.warehouseId, params.warehouseId)))
        .orderBy(sql`rowid DESC`)
        .limit(1);

      const previousBalance = currentBalanceRes[0]?.balanceAfter || 0;
      const newBalance = previousBalance + receivedPieces;

      queries.push(db.insert(erpStockLedger).values({
        id: `stk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        organizationId: context.organizationId,
        itemId: poLine.itemId,
        warehouseId: params.warehouseId,
        changeType: "purchase_receipt",
        quantityChange: receivedPieces,
        balanceAfter: newBalance,
        unitCost: poLine.unitPrice,
        totalValue: receivedPieces * poLine.unitPrice,
        referenceDoc: receiptNumber,
      }));

      // Update moving average cost (E08)
      const costRes = await db.select().from(erpItemCosting)
        .where(and(eq(erpItemCosting.organizationId, context.organizationId), eq(erpItemCosting.itemId, poLine.itemId)))
        .limit(1);

      const currentQty = costRes[0]?.totalQuantity || 0;
      const currentCost = costRes[0]?.totalCost || 0;
      const ma = calculateMovingAverage({
        currentQty,
        currentTotalCost: currentCost,
        incomingQty: receivedPieces,
        incomingUnitCost: poLine.unitPrice,
      });

      if (costRes.length === 0) {
        queries.push(db.insert(erpItemCosting).values({
          id: `cost_${poLine.itemId}`,
          organizationId: context.organizationId,
          itemId: poLine.itemId,
          totalQuantity: ma.totalQuantity,
          totalCost: ma.totalCost,
          movingAverageCost: ma.unitCost,
        }));
      } else {
        queries.push(db.update(erpItemCosting).set({
          totalQuantity: ma.totalQuantity,
          totalCost: ma.totalCost,
          movingAverageCost: ma.unitCost,
          updatedAt: new Date().toISOString(),
        }).where(eq(erpItemCosting.id, costRes[0].id)));
      }
    }

    await db.batch(queries as any);
    return { success: true, receiptNumber };
  }

  /**
   * E03: Return goods to supplier (creates contra entry)
   */
  static async returnGoods(context: TenantContext, params: {
    itemId: string;
    warehouseId: string;
    quantity: number;
    reason: string;
    referenceDoc: string;
  }) {
    const perm = checkPermission(context, "operator");
    if (!perm.allowed) throw new Error(perm.message);

    const db = getDb();
    const qtyToReturn = params.quantity;
    if (!Number.isSafeInteger(qtyToReturn) || qtyToReturn <= 0 || !params.reason.trim()) throw new Error("退貨數量必須為正整數且原因必填");

    // Get current stock
    const currentBalanceRes = await db.select().from(erpStockLedger)
      .where(and(eq(erpStockLedger.organizationId, context.organizationId), eq(erpStockLedger.itemId, params.itemId), eq(erpStockLedger.warehouseId, params.warehouseId)))
      .orderBy(sql`rowid DESC`)
      .limit(1);

    const previousBalance = currentBalanceRes[0]?.balanceAfter || 0;
    if (previousBalance < qtyToReturn) {
      throw new Error(`庫存不足，無法退貨！現有庫存 ${previousBalance}，欲退貨 ${qtyToReturn}`);
    }

    const newBalance = previousBalance - qtyToReturn;
    const unitCost = currentBalanceRes[0]?.unitCost || 0;

    await db.insert(erpStockLedger).values({
      id: `stk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      organizationId: context.organizationId,
      itemId: params.itemId,
      warehouseId: params.warehouseId,
      changeType: "purchase_return",
      quantityChange: -qtyToReturn,
      balanceAfter: newBalance,
      unitCost,
      totalValue: -qtyToReturn * unitCost,
      referenceDoc: params.referenceDoc,
    });

    await recordAuditEvent({
      context,
      action: "PURCHASE_RETURN",
      entityType: "ERP_STOCK",
      entityId: params.itemId,
      beforeValue: { stock: previousBalance },
      afterValue: { stock: newBalance, returned: qtyToReturn },
      reason: params.reason,
    });

    return { success: true, balanceAfter: newBalance };
  }

  /**
   * E04: Stock Transfer between warehouses (Conservation of mass/total stock)
   */
  static async transferStock(context: TenantContext, params: {
    itemId: string;
    fromWarehouseId: string;
    toWarehouseId: string;
    quantity: number;
  }) {
    const perm = checkPermission(context, "operator");
    if (!perm.allowed) throw new Error(perm.message);

    if (params.fromWarehouseId === params.toWarehouseId) {
      throw new Error("來源倉與目的倉不能相同");
    }

    const db = getDb();
    const queries: any[] = [];
    const qty = params.quantity;
    if (!Number.isSafeInteger(qty) || qty <= 0) throw new Error("數量必須是正整數");

    // Check source warehouse balance
    const sourceRes = await db.select().from(erpStockLedger)
      .where(and(eq(erpStockLedger.organizationId, context.organizationId), eq(erpStockLedger.itemId, params.itemId), eq(erpStockLedger.warehouseId, params.fromWarehouseId)))
      .orderBy(sql`rowid DESC`)
      .limit(1);

    const sourcePrev = sourceRes[0]?.balanceAfter || 0;
    if (sourcePrev < qty) {
      throw new Error(`調撥失敗：來源倉庫存不足！現有 ${sourcePrev}，欲調撥 ${qty}`);
    }

    // Check dest warehouse balance
    const destRes = await db.select().from(erpStockLedger)
      .where(and(eq(erpStockLedger.organizationId, context.organizationId), eq(erpStockLedger.itemId, params.itemId), eq(erpStockLedger.warehouseId, params.toWarehouseId)))
      .orderBy(sql`rowid DESC`)
      .limit(1);

    const destPrev = destRes[0]?.balanceAfter || 0;
    const transferRef = `TR-${Date.now()}`;
    const unitCost = sourceRes[0]?.unitCost || 0;

    // Deduct from source
    queries.push(db.insert(erpStockLedger).values({
      id: `stk_tr_out_${crypto.randomUUID()}`,
      organizationId: context.organizationId,
      itemId: params.itemId,
      warehouseId: params.fromWarehouseId,
      changeType: "transfer_out",
      quantityChange: -qty,
      balanceAfter: sourcePrev - qty,
      unitCost,
      totalValue: -qty * unitCost,
      referenceDoc: transferRef,
    }));

    // Add to dest
    queries.push(db.insert(erpStockLedger).values({
      id: `stk_tr_in_${crypto.randomUUID()}`,
      organizationId: context.organizationId,
      itemId: params.itemId,
      warehouseId: params.toWarehouseId,
      changeType: "transfer_in",
      quantityChange: qty,
      balanceAfter: destPrev + qty,
      unitCost,
      totalValue: qty * unitCost,
      referenceDoc: transferRef,
    }));

    await db.batch(queries as any);
    return {
      success: true,
      transferRef,
      sourceBalanceAfter: sourcePrev - qty,
      destBalanceAfter: destPrev + qty,
      totalQuantityPreserved: true,
    };
  }

  /**
   * E05: Ship Sales Order with partial shipments & anti-overselling
   */
  static async shipSalesOrder(context: TenantContext, params: {
    soId: string;
    warehouseId: string;
    shipLines: Array<{ lineId: string; quantity: number }>;
  }) {
    const perm = checkPermission(context, "operator");
    if (!perm.allowed) throw new Error(perm.message);

    const db = getDb();
    const queries: any[] = [];
    const soList = await db.select().from(erpSalesOrders)
      .where(and(eq(erpSalesOrders.organizationId, context.organizationId), eq(erpSalesOrders.id, params.soId)))
      .limit(1);

    if (soList.length === 0) throw new Error("銷售訂單不存在");
    const so = soList[0];
    if (so.status === "cancelled" || so.status === "shipped") {
      throw new Error(`訂單目前狀態為 ${so.status}，無法再出貨`);
    }

    if (!params.shipLines.length || new Set(params.shipLines.map(line => line.lineId)).size !== params.shipLines.length) throw new Error("出貨明細不可為空或重複");
    const warehouse = await db.select().from(erpWarehouses).where(and(eq(erpWarehouses.id, params.warehouseId), eq(erpWarehouses.organizationId, context.organizationId))).limit(1);
    if (!warehouse.length) throw new Error("倉庫不存在");
    const shipmentNumber = `SH-${Date.now()}`;
    const shipmentId = `ship_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    queries.push(db.insert(erpShipments).values({
      id: shipmentId,
      organizationId: context.organizationId,
      shipmentNumber,
      soId: params.soId,
      warehouseId: params.warehouseId,
      status: "completed",
    }));

    const orderLines = await db.select().from(erpSalesOrderLines).where(and(eq(erpSalesOrderLines.organizationId, context.organizationId), eq(erpSalesOrderLines.soId, params.soId)));
    let allFulfilled = orderLines.every(line => line.shippedQuantity + (params.shipLines.find(input => input.lineId === line.id)?.quantity || 0) >= line.quantity);

    for (const sLine of params.shipLines) {
      const sol = await db.select().from(erpSalesOrderLines)
        .where(and(eq(erpSalesOrderLines.organizationId, context.organizationId), eq(erpSalesOrderLines.soId, params.soId), eq(erpSalesOrderLines.id, sLine.lineId)))
        .limit(1);

      if (sol.length === 0) throw new Error(`訂單明細 ${sLine.lineId} 不存在`);
      const soLine = sol[0];

      if (!Number.isSafeInteger(sLine.quantity) || sLine.quantity <= 0) throw new Error("出貨數量必須為正整數");
      const remainingToShip = soLine.quantity - soLine.shippedQuantity;
      if (sLine.quantity > remainingToShip) {
        throw new Error(`超賣/超量出貨被拒！訂單量 ${soLine.quantity}，已出 ${soLine.shippedQuantity}，本次欲出 ${sLine.quantity}，超過剩餘量 ${remainingToShip} (E05)`);
      }

      // Check warehouse stock
      const stockRes = await db.select().from(erpStockLedger)
        .where(and(eq(erpStockLedger.organizationId, context.organizationId), eq(erpStockLedger.itemId, soLine.itemId), eq(erpStockLedger.warehouseId, params.warehouseId)))
        .orderBy(sql`rowid DESC`)
        .limit(1);

      const currentStock = stockRes[0]?.balanceAfter || 0;
      if (currentStock < sLine.quantity) {
        throw new Error(`倉位庫存不足，防止超賣！現有庫存 ${currentStock}，欲出貨 ${sLine.quantity} (E04)`);
      }

      // Update SO line
      const newShipped = soLine.shippedQuantity + sLine.quantity;
      queries.push(db.update(erpSalesOrderLines)
        .set({ shippedQuantity: sql`${erpSalesOrderLines.shippedQuantity} + ${sLine.quantity}` })
        .where(eq(erpSalesOrderLines.id, sLine.lineId)));

      if (newShipped < soLine.quantity) {
        allFulfilled = false;
      }

      // Shipment line
      queries.push(db.insert(erpShipmentLines).values({
        id: `shl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        organizationId: context.organizationId,
        shipmentId,
        itemId: soLine.itemId,
        quantity: sLine.quantity,
        unitCost: stockRes[0]?.unitCost || 0,
      }));

      // Deduct stock ledger
      queries.push(db.insert(erpStockLedger).values({
        id: `stk_ship_${crypto.randomUUID()}`,
        organizationId: context.organizationId,
        itemId: soLine.itemId,
        warehouseId: params.warehouseId,
        changeType: "sales_shipment",
        quantityChange: -sLine.quantity,
        balanceAfter: currentStock - sLine.quantity,
        unitCost: stockRes[0]?.unitCost || 0,
        totalValue: -sLine.quantity * (stockRes[0]?.unitCost || 0),
        referenceDoc: shipmentNumber,
      }));
    }

    // Update SO status
    const updatedStatus = allFulfilled ? "shipped" : "partially_shipped";
    queries.push(db.update(erpSalesOrders)
      .set({ status: updatedStatus })
      .where(eq(erpSalesOrders.id, params.soId)));

    await db.batch(queries as any);
    return { success: true, shipmentNumber, orderStatus: updatedStatus };
  }

  /**
   * E06: Settle invoice payment (Checks overpayment & closes invoice)
   */
  static async settleInvoicePayment(context: TenantContext, params: {
    invoiceId: string;
    amount: number;
    paymentMethod?: string;
  }) {
    const perm = checkPermission(context, "operator");
    if (!perm.allowed) throw new Error(perm.message);

    const db = getDb();
    const queries: any[] = [];
    const invRes = await db.select().from(erpInvoices)
      .where(and(eq(erpInvoices.organizationId, context.organizationId), eq(erpInvoices.id, params.invoiceId)))
      .limit(1);

    if (invRes.length === 0) throw new Error("發票/帳單不存在");
    const inv = invRes[0];

    if (!Number.isSafeInteger(params.amount) || params.amount <= 0) throw new Error("付款金額必須為正整數");
    const unpaidAmount = inv.totalAmount - inv.paidAmount;
    if (params.amount > unpaidAmount) {
      throw new Error(`超收拒絕！未清金額為 ${unpaidAmount}，本次支付 ${params.amount}。不可默默結清 (E06)`);
    }

    const newPaidAmount = inv.paidAmount + params.amount;
    const newStatus = newPaidAmount >= inv.totalAmount ? "paid" : "partially_paid";

    queries.push(db.update(erpInvoices)
      .set({ paidAmount: sql`${erpInvoices.paidAmount} + ${params.amount}`, status: sql`CASE WHEN ${erpInvoices.paidAmount} + ${params.amount} >= ${erpInvoices.totalAmount} THEN 'paid' ELSE 'partially_paid' END` })
      .where(eq(erpInvoices.id, params.invoiceId)));

    const paymentNumber = `PAY-${Date.now()}`;
    queries.push(db.insert(erpPayments).values({
      id: `pay_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      organizationId: context.organizationId,
      paymentNumber,
      invoiceId: params.invoiceId,
      amount: params.amount,
      paymentMethod: params.paymentMethod || "bank_transfer",
    }));

    await db.batch(queries as any);
    return {
      success: true,
      paidAmount: newPaidAmount,
      unpaidAmount: inv.totalAmount - newPaidAmount,
      status: newStatus,
    };
  }

  /**
   * E07: Create General Ledger Journal Entry with strict Debit == Credit balance check
   */
  static async createJournalEntry(context: TenantContext, params: {
    entryDate: string;
    description: string;
    referenceDoc?: string;
    lines: Array<{
      accountCode: string;
      accountName: string;
      debitAmount: number;
      creditAmount: number;
    }>;
  }) {
    const perm = checkPermission(context, "operator");
    if (!perm.allowed) throw new Error(perm.message);

    let totalDebit = 0;
    let totalCredit = 0;

    if (params.lines.length < 2 || !/^\d{4}-\d{2}-\d{2}$/.test(params.entryDate)) throw new Error("傳票日期與明細格式無效");
    for (const l of params.lines) {
      if (![l.debitAmount, l.creditAmount].every(amount => Number.isSafeInteger(amount) && amount >= 0) || (l.debitAmount > 0 && l.creditAmount > 0)) throw new Error("每筆傳票必須為非負整數且僅填借方或貸方");
      totalDebit += Math.max(0, l.debitAmount || 0);
      totalCredit += Math.max(0, l.creditAmount || 0);
    }

    if (totalDebit !== totalCredit) {
      throw new Error(`傳票借貸不平衡！借方總額 ${totalDebit} !== 貸方總額 ${totalCredit}，系統嚴格拒絕過帳 (E07)`);
    }

    if (totalDebit === 0) {
      throw new Error("傳票金額不得為0");
    }

    const db = getDb();
    const queries: any[] = [];
    const closedPeriods = await db.select().from(erpFiscalPeriods).where(and(eq(erpFiscalPeriods.organizationId, context.organizationId), eq(erpFiscalPeriods.isClosed, true)));
    if (closedPeriods.some(period => period.startDate <= params.entryDate && period.endDate >= params.entryDate)) throw new Error("已關帳期間不可回寫");
    const entryId = `je_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const entryNumber = `JE-${Date.now()}`;

    queries.push(db.insert(erpJournalEntries).values({
      id: entryId,
      organizationId: context.organizationId,
      entryNumber,
      entryDate: params.entryDate,
      description: params.description,
      referenceDoc: params.referenceDoc,
      status: "posted",
    }));

    for (const line of params.lines) {
      queries.push(db.insert(erpJournalLines).values({
        id: `jel_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        organizationId: context.organizationId,
        journalId: entryId,
        accountCode: line.accountCode,
        accountName: line.accountName,
        debitAmount: line.debitAmount,
        creditAmount: line.creditAmount,
      }));
    }

    await db.batch(queries as any);
    return { success: true, entryNumber, totalDebit, totalCredit };
  }

  /**
   * E08: Trial Balance calculation with drill-down capability
   */
  static async getTrialBalance(context: TenantContext) {
    const db = getDb();
    const lines = await db.select().from(erpJournalLines)
      .where(eq(erpJournalLines.organizationId, context.organizationId));

    const accountMap = new Map<string, { code: string; name: string; debitTotal: number; creditTotal: number }>();

    for (const line of lines) {
      const existing = accountMap.get(line.accountCode) || {
        code: line.accountCode,
        name: line.accountName,
        debitTotal: 0,
        creditTotal: 0,
      };
      existing.debitTotal += line.debitAmount;
      existing.creditTotal += line.creditAmount;
      accountMap.set(line.accountCode, existing);
    }

    let grandDebit = 0;
    let grandCredit = 0;
    const accounts = Array.from(accountMap.values()).map((acc) => {
      grandDebit += acc.debitTotal;
      grandCredit += acc.creditTotal;
      return acc;
    });

    return {
      accounts,
      grandDebit,
      grandCredit,
      isBalanced: grandDebit === grandCredit,
    };
  }
}

