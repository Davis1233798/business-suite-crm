import { eq, and, sql } from "drizzle-orm";
import { getDb } from "../../db/index";
import {
  posStores,
  posRegisters,
  posShifts,
  posCatalogItems,
  posHeldCarts,
  posSales,
  posSaleLines,
  posRefunds,
  posRefundLines,
  posCashMovements,
  idempotencyKeys,
} from "../../db/schema";
import { TenantContext, checkPermission } from "../tenant";
import { recordAuditEvent } from "../audit";
import { checkIdempotency, saveIdempotency } from "../idempotency";

export class PosService {
  /**
   * P01: Lookup barcode, fetch server-side price, reject inactive
   */
  static async scanBarcode(context: TenantContext, barcode: string) {
    const db = getDb();
    const items = await db.select().from(posCatalogItems)
      .where(and(eq(posCatalogItems.organizationId, context.organizationId), eq(posCatalogItems.barcode, barcode)))
      .limit(1);

    if (items.length === 0) {
      throw new Error(`找不到條碼為 ${barcode} 的商品`);
    }

    const item = items[0];
    if (!item.isActive) {
      throw new Error(`商品 ${item.name} 已停用，不能新增交易 (P01)`);
    }

    return item;
  }

  /**
   * P02 & P03: Checkout Cart
   */
  static async checkout(context: TenantContext, params: {
    storeId: string;
    registerId: string;
    shiftId: string;
    items: Array<{ barcode: string; quantity: number; lineDiscount?: number }>;
    tenderAmount: number; // Cash paid by customer
    paymentMethod?: string;
    idempotencyKey?: string;
  }) {
    const perm = checkPermission(context, "operator");
    if (!perm.allowed) throw new Error(perm.message);

    const db = getDb();

    if (!Array.isArray(params.items) || !params.items.length) throw new Error("購物車不可為空");
    if (!Number.isSafeInteger(params.tenderAmount) || params.tenderAmount < 0) throw new Error("付款金額必須為非負整數");
    const barcodes = params.items.map(item => item.barcode);
    if (new Set(barcodes).size !== barcodes.length) throw new Error("請合併相同條碼商品數量");
    // Check shift is open
    const shiftRes = await db.select().from(posShifts)
      .where(and(eq(posShifts.organizationId, context.organizationId), eq(posShifts.id, params.shiftId)))
      .limit(1);

    if (shiftRes.length === 0 || shiftRes[0].status !== "open") {
      throw new Error("收銀班別未開啟或已結班，無法進行收銀");
    }

    if (shiftRes[0].storeId !== params.storeId || shiftRes[0].registerId !== params.registerId) throw new Error("班別與門市或收銀機不符");
    // Idempotency check (C06 / P03)
    if (params.idempotencyKey) {
      const idem = await checkIdempotency(context, params.idempotencyKey, "/api/pos/checkout");
      if (idem.isDuplicate && idem.cachedResponse) {
        return idem.cachedResponse;
      }
    }

    // Server-side authoritative price and stock deduction
    let subtotal = 0;
    let discountAmount = 0;
    const resolvedLines: Array<{
      item: any;
      quantity: number;
      unitPrice: number;
      lineDiscount: number;
      lineTotal: number;
    }> = [];

    for (const input of params.items) {
      const item = await this.scanBarcode(context, input.barcode);
      const qty = input.quantity;
      if (!Number.isSafeInteger(qty) || qty <= 0) throw new Error("商品數量必須是正整數");

      if (item.stockQuantity < qty) {
        throw new Error(`商品 ${item.name} 門市庫存不足！現有 ${item.stockQuantity}，欲購 ${qty}`);
      }

      const unitPrice = item.price; // Server price ONLY
      const lineSub = unitPrice * qty;
      const lDisc = Math.min(lineSub, Math.max(0, input.lineDiscount || 0));
      const lineTotal = lineSub - lDisc;

      subtotal += lineSub;
      discountAmount += lDisc;

      resolvedLines.push({
        item,
        quantity: qty,
        unitPrice,
        lineDiscount: lDisc,
        lineTotal,
      });
    }

    const totalAmount = subtotal - discountAmount;
    if (params.tenderAmount < totalAmount) {
      throw new Error(`付款金額不足！應收 ${totalAmount}，實收 ${params.tenderAmount}，無法結帳 (P03)`);
    }

    const changeAmount = params.tenderAmount - totalAmount;
    const saleId = `sale_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const receiptNumber = `RCP-${Date.now()}`;

    const queries: any[] = [];
    queries.push(db.insert(posSales).values({
      id: saleId,
      organizationId: context.organizationId,
      receiptNumber,
      storeId: params.storeId,
      registerId: params.registerId,
      shiftId: params.shiftId,
      cashierId: context.userId,
      subtotal,
      discountAmount,
      totalAmount,
      tenderAmount: params.tenderAmount,
      changeAmount,
      paymentMethod: params.paymentMethod || "cash",
      status: "completed",
      isReprint: false,
      idempotencyKey: params.idempotencyKey || null,
    }));

    // Deduct stock and insert sale lines
    for (const rLine of resolvedLines) {
      queries.push(db.insert(posSaleLines).values({
        id: `sl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        organizationId: context.organizationId,
        saleId,
        itemId: rLine.item.id,
        barcode: rLine.item.barcode,
        name: rLine.item.name,
        unitPrice: rLine.unitPrice,
        quantity: rLine.quantity,
        discountAmount: rLine.lineDiscount,
        lineTotal: rLine.lineTotal,
        refundedQuantity: 0,
      }));

      // Deduct inventory
      queries.push(db.update(posCatalogItems)
        .set({ stockQuantity: sql`${posCatalogItems.stockQuantity} - ${rLine.quantity}` })
        .where(and(eq(posCatalogItems.id, rLine.item.id), eq(posCatalogItems.organizationId, context.organizationId))));
    }

    const result = {
      success: true,
      saleId,
      receiptNumber,
      subtotal,
      discountAmount,
      totalAmount,
      tenderAmount: params.tenderAmount,
      changeAmount,
    };

    if (params.idempotencyKey) {
      queries.push(db.insert(idempotencyKeys).values({ id: crypto.randomUUID(), organizationId: context.organizationId, key: params.idempotencyKey, endpoint: "/api/pos/checkout", requestHash: params.idempotencyKey, responseStatus: 200, responseBody: JSON.stringify(result) }));
    }

    try { await db.batch(queries as any); } catch (error) {
      if (params.idempotencyKey) { const replay = await checkIdempotency(context, params.idempotencyKey, "/api/pos/checkout"); if (replay.isDuplicate) return replay.cachedResponse; }
      throw error;
    }
    return result;
  }

  /**
   * P04: Hold and Retrieve Cart across registers
   */
  static async holdCart(context: TenantContext, params: {
    storeId: string;
    cartName: string;
    items: any[];
  }) {
    const db = getDb();
    if (!checkPermission(context, "operator").allowed) throw new Error("403 Forbidden");
    const cartId = `cart_held_${crypto.randomUUID()}`;

    await db.insert(posHeldCarts).values({
      id: cartId,
      organizationId: context.organizationId,
      storeId: params.storeId,
      cartName: params.cartName,
      itemsJson: JSON.stringify(params.items),
      status: "held",
    });

    return { success: true, cartId };
  }

  static async retrieveCart(context: TenantContext, cartId: string, lockedBy: string) {
    const db = getDb();
    if (!checkPermission(context, "operator").allowed) throw new Error("403 Forbidden");
    const carts = await db.select().from(posHeldCarts)
      .where(and(eq(posHeldCarts.organizationId, context.organizationId), eq(posHeldCarts.id, cartId)))
      .limit(1);

    if (carts.length === 0) throw new Error("掛單不存在");
    const cart = carts[0];

    if (cart.status !== "held") {
      throw new Error(`此單已被其他工作站取走或已結帳 (${cart.status}) (P04)`);
    }

    // Only the winner of the conditional update receives the cart.
    const claimed = await db.update(posHeldCarts)
      .set({ status: "retrieved", lockedBy })
      .where(and(eq(posHeldCarts.organizationId, context.organizationId), eq(posHeldCarts.id, cartId), eq(posHeldCarts.status, "held"))).returning();
    if (!claimed.length) throw new Error("此掛單已被其他工作站取走 (P04)");

    return {
      success: true,
      cartName: cart.cartName,
      items: JSON.parse(cart.itemsJson),
    };
  }

  /**
   * P05: Refund sale with manager permission and strict proportional allocation
   */
  static async refundSale(context: TenantContext, params: {
    saleId: string;
    lineReturns: Array<{ lineId: string; quantity: number }>;
    reason: string;
  }) {
    // Requires admin / manager role (P05)
    const perm = checkPermission(context, "admin");
    if (!perm.allowed) {
      throw new Error(`退款必須具有店長或管理員權限 (P05): ${perm.message}`);
    }

    if (!params.reason) {
      throw new Error("退款必須填寫原因說明 (P05)");
    }

    const db = getDb();
    const queries: any[] = [];
    if (!params.lineReturns.length || new Set(params.lineReturns.map(r => r.lineId)).size !== params.lineReturns.length) throw new Error("請選擇不重複的退貨明細");
    const sales = await db.select().from(posSales)
      .where(and(eq(posSales.organizationId, context.organizationId), eq(posSales.id, params.saleId)))
      .limit(1);

    if (sales.length === 0) throw new Error("銷售紀錄不存在");
    const sale = sales[0];

    let totalRefundAmount = 0;
    const refundLines: Array<{ lineId: string; qty: number; amount: number; itemId: string }> = [];

    for (const ret of params.lineReturns) {
      const lines = await db.select().from(posSaleLines)
        .where(and(eq(posSaleLines.organizationId, context.organizationId), eq(posSaleLines.saleId, params.saleId), eq(posSaleLines.id, ret.lineId)))
        .limit(1);

      if (lines.length === 0) throw new Error(`找不到銷售明細行 ${ret.lineId}`);
      const line = lines[0];

      if (!Number.isSafeInteger(ret.quantity) || ret.quantity <= 0) throw new Error("退貨數量必須是正整數");
      const maxRefundableQty = line.quantity - line.refundedQuantity;
      if (ret.quantity > maxRefundableQty) {
        throw new Error(`累計超退拒絕！原購 ${line.quantity}，已退 ${line.refundedQuantity}，本次欲退 ${ret.quantity}，超過可退量 ${maxRefundableQty} (P05)`);
      }

      // Proportional refund per unit considering line discount
      const effectiveUnitPrice = Math.floor(line.lineTotal / line.quantity);
      const lineRefundAmount = Math.floor(line.lineTotal * (line.refundedQuantity + ret.quantity) / line.quantity) - Math.floor(line.lineTotal * line.refundedQuantity / line.quantity);

      totalRefundAmount += lineRefundAmount;
      refundLines.push({
        lineId: line.id,
        qty: ret.quantity,
        amount: lineRefundAmount,
        itemId: line.itemId,
      });

      // Update line refunded quantity
      queries.push(db.update(posSaleLines)
        .set({ refundedQuantity: sql`${posSaleLines.refundedQuantity} + ${ret.quantity}` })
        .where(eq(posSaleLines.id, line.id)));

      // Restore inventory
      const catItem = await db.select().from(posCatalogItems)
        .where(eq(posCatalogItems.id, line.itemId))
        .limit(1);
      if (catItem.length > 0) {
        queries.push(db.update(posCatalogItems)
          .set({ stockQuantity: sql`${posCatalogItems.stockQuantity} + ${ret.quantity}` })
          .where(eq(posCatalogItems.id, line.itemId)));
      }
    }

    const refundId = `ref_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const refundNumber = `REF-${Date.now()}`;

    queries.push(db.insert(posRefunds).values({
      id: refundId,
      organizationId: context.organizationId,
      refundNumber,
      originalSaleId: params.saleId,
      managerId: context.userId,
      reason: params.reason,
      refundAmount: totalRefundAmount,
    }));

    for (const rl of refundLines) {
      queries.push(db.insert(posRefundLines).values({
        id: `refl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        organizationId: context.organizationId,
        refundId,
        saleLineId: rl.lineId,
        quantity: rl.qty,
        amount: rl.amount,
      }));
    }

    // Update sale status
    queries.push(db.update(posSales)
      .set({ status: "refunded" })
      .where(eq(posSales.id, params.saleId)));

    await db.batch(queries as any);
    await recordAuditEvent({
      context,
      action: "POS_REFUND",
      entityType: "POS_SALE",
      entityId: params.saleId,
      beforeValue: { status: sale.status },
      afterValue: { status: "refunded", refundAmount: totalRefundAmount },
      reason: params.reason,
    });

    return { success: true, refundNumber, totalRefundAmount };
  }

  /**
   * P06: Open / Close shift with cash discrepancy calculation
   */
  static async closeShift(context: TenantContext, params: {
    shiftId: string;
    closingCash: number;
    notes?: string;
  }) {
    const db = getDb();
    if (!checkPermission(context, "operator").allowed) throw new Error("403 Forbidden");
    if (!Number.isSafeInteger(params.closingCash) || params.closingCash < 0) throw new Error("盤點現金必須為非負整數");
    const shiftRes = await db.select().from(posShifts)
      .where(and(eq(posShifts.organizationId, context.organizationId), eq(posShifts.id, params.shiftId)))
      .limit(1);

    if (shiftRes.length === 0) throw new Error("班別不存在");
    if (shiftRes[0].status !== "open") throw new Error("班別已結班");
    const shift = shiftRes[0];

    // Compute cash sales
    const sales = await db.select().from(posSales)
      .where(and(eq(posSales.shiftId, params.shiftId), eq(posSales.paymentMethod, "cash")));

    let totalCashSales = 0;
    for (const s of sales) {
      totalCashSales += s.totalAmount;
    }

    // Compute refunds
    const refunds = await db.select().from(posRefunds)
      .where(eq(posRefunds.organizationId, context.organizationId));
    // Filter refunds for sales in this shift
    const saleIdsInShift = new Set(sales.map(s => s.id));
    let totalCashRefunds = 0;
    for (const r of refunds) {
      if (saleIdsInShift.has(r.originalSaleId)) {
        totalCashRefunds += r.refundAmount;
      }
    }

    const expectedCash = shift.openingCash + totalCashSales - totalCashRefunds;
    const discrepancy = params.closingCash - expectedCash;

    if (discrepancy !== 0 && !params.notes) {
      throw new Error(`現金盤點有差異 (${discrepancy})，結班必須填寫說明 (P06)`);
    }

    await db.update(posShifts).set({
      closingCash: params.closingCash,
      expectedCash,
      cashDiscrepancy: discrepancy,
      status: "closed",
      closedAt: new Date().toISOString(),
      notes: params.notes || null,
    }).where(eq(posShifts.id, params.shiftId));

    return {
      success: true,
      openingCash: shift.openingCash,
      totalCashSales,
      totalCashRefunds,
      expectedCash,
      closingCash: params.closingCash,
      discrepancy,
    };
  }

  /**
   * P07: Reprint receipt (flagged as reprint, no duplicate charges)
   */
  static async reprintReceipt(context: TenantContext, receiptNumber: string) {
    const db = getDb();
    const sales = await db.select().from(posSales)
      .where(and(eq(posSales.organizationId, context.organizationId), eq(posSales.receiptNumber, receiptNumber)))
      .limit(1);

    if (sales.length === 0) throw new Error("找不到該收據");
    const sale = sales[0];

    const lines = await db.select().from(posSaleLines)
      .where(eq(posSaleLines.saleId, sale.id));

    return {
      ...sale,
      isReprint: true, // Marked clearly as reprint (P07)
      lines,
    };
  }

  /**
   * P08: Daily Report (Net = Sales - Refunds, Asia/Taipei cross-midnight)
   */
  static async getDailyReport(context: TenantContext, storeId: string, dateStr?: string) {
    const db = getDb();
    const taipeiDate = (value: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(/[zZ]|[+]\d{2}:/.test(value) ? value : value.replace(" ", "T") + "Z"));
    const targetDate = dateStr || taipeiDate(new Date().toISOString());

    const sales = await db.select().from(posSales)
      .where(and(
        eq(posSales.organizationId, context.organizationId),
        eq(posSales.storeId, storeId)
      ));

    // Filter sales on target date
    const daySales = sales.filter(s => taipeiDate(s.createdAt) === targetDate);
    const grossSales = daySales.reduce((sum, s) => sum + s.totalAmount, 0);

    const refunds = await db.select().from(posRefunds)
      .where(eq(posRefunds.organizationId, context.organizationId));
    const storeSaleIds = new Set(sales.map(sale => sale.id));
    const dayRefunds = refunds.filter(r => storeSaleIds.has(r.originalSaleId) && taipeiDate(r.createdAt) === targetDate);
    const totalRefunds = dayRefunds.reduce((sum, r) => sum + r.refundAmount, 0);

    const netSales = grossSales - totalRefunds;

    return {
      date: targetDate,
      storeId,
      grossSales,
      totalRefunds,
      netSales,
      transactionCount: daySales.length,
      refundCount: dayRefunds.length,
    };
  }
}
