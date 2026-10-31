import { eq, and, sql, desc, or, like, gte, lte, inArray } from "drizzle-orm";
import { getDb } from "../../db/index";
import {
  shopCategories,
  shopProducts,
  shopVariants,
  shopCarts,
  shopCartItems,
  shopPromotions,
  shopOrders,
  shopOrderItems,
  shopPaymentAttempts,
  shopShipments,
  shopReturns,
  shopReviews,
  shopInventoryReservations,
  idempotencyKeys,
  outboxEvents,
} from "../../db/schema";
import { TenantContext, checkPermission } from "../tenant";
import { recordAuditEvent } from "../audit";
import { calculateOrderAmounts } from "../money";
import { checkIdempotency, saveIdempotency } from "../idempotency";
import { cachedCatalog } from "../infrastructure";

export class ShopService {
  static async releaseExpiredReservations(context: TenantContext) {
    const db = getDb();
    const now = new Date().toISOString();
    const expired = await db.select().from(shopInventoryReservations).where(and(eq(shopInventoryReservations.organizationId, context.organizationId), eq(shopInventoryReservations.status, "active"), lte(shopInventoryReservations.expiresAt, now)));
    for (const reservation of expired) {
      await db.batch([
        db.update(shopVariants).set({ stockQuantity: sql`${shopVariants.stockQuantity} + COALESCE((SELECT quantity FROM shop_inventory_reservations WHERE id = ${reservation.id} AND status = 'active'), 0)` }).where(and(eq(shopVariants.organizationId, context.organizationId), eq(shopVariants.id, reservation.variantId))),
        db.update(shopInventoryReservations).set({status:"expired"}).where(and(eq(shopInventoryReservations.id, reservation.id), eq(shopInventoryReservations.status,"active"))),
        db.update(shopOrders).set({paymentStatus:"expired"}).where(and(eq(shopOrders.id, reservation.cartId || ""), eq(shopOrders.organizationId, context.organizationId), or(eq(shopOrders.paymentStatus,"pending"),eq(shopOrders.paymentStatus,"failed")))),
      ]);
    }
  }

  /**
   * S01: Search products with category filter, price, and pagination
   */
  static async searchProducts(context: TenantContext, params: {
    categoryId?: string;
    keyword?: string;
    minPrice?: number;
    maxPrice?: number;
    page?: number;
    limit?: number;
  }) {
    const db = getDb();
    await this.releaseExpiredReservations(context);
    const page = Math.max(1, params.page || 1);
    const limit = Math.max(1, Math.min(50, params.limit || 10));
    const offset = (page - 1) * limit;

    let query = db.select().from(shopProducts)
      .where(and(
        eq(shopProducts.organizationId, context.organizationId),
        eq(shopProducts.isActive, true),
        params.categoryId ? eq(shopProducts.categoryId, params.categoryId) : undefined,
        params.keyword ? like(shopProducts.name, `%${params.keyword}%`) : undefined
      ))
      .limit(limit)
      .offset(offset);

    const products = await cachedCatalog(context.organizationId, { keyword: params.keyword, categoryId: params.categoryId, page, limit }, async () => await query);
    // One live query per catalog page instead of one query per product.
    const variants = products.length ? await db.select().from(shopVariants).where(and(
      eq(shopVariants.organizationId, context.organizationId),
      inArray(shopVariants.productId, products.map(p => p.id)),
      eq(shopVariants.isActive, true),
      params.minPrice !== undefined ? gte(shopVariants.price, params.minPrice) : undefined,
      params.maxPrice !== undefined ? lte(shopVariants.price, params.maxPrice) : undefined,
    )) : [];
    const enriched = products.map(p => ({ ...p, variants: variants.filter(v => v.productId === p.id) }));

    return {
      products: enriched.filter(p => p.variants.length > 0),
      page,
      limit,
    };
  }

  /**
   * S03 & S04: Create Order with inventory reservation, coupons, and anti-overselling
   */
  static async checkoutCart(context: TenantContext, params: {
    sessionId: string;
    customerEmail: string;
    shippingAddress: { name: string; city: string; address: string; phone: string };
    items: Array<{ variantId: string; quantity: number }>;
    couponCode?: string;
    shippingFee?: number;
    idempotencyKey?: string;
  }) {
    const db = getDb();
    await this.releaseExpiredReservations(context);

    const permission = checkPermission(context, "operator");
    if (!permission.allowed) throw new Error(permission.message);
    if (!Array.isArray(params.items) || !params.items.length || params.items.length > 50) throw new Error("購物車須包含 1 至 50 項商品");
    if (!params.customerEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(params.customerEmail)) throw new Error("請填寫有效電子郵件");
    for (const field of ["name", "city", "address", "phone"] as const) if (!params.shippingAddress?.[field]?.trim() || params.shippingAddress[field].length > 300) throw new Error("請填寫完整收件資料");
    const merged = new Map<string, number>();
    for (const item of params.items) {
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0 || item.quantity > 999) throw new Error("商品數量須為 1 至 999 的整數");
      merged.set(item.variantId, (merged.get(item.variantId) || 0) + item.quantity);
    }
    params.items = Array.from(merged, ([variantId, quantity]) => ({ variantId, quantity }));
    // Idempotency check (C06 / S05)
    if (params.idempotencyKey) {
      const idem = await checkIdempotency(context, params.idempotencyKey, "/api/shop/checkout");
      if (idem.isDuplicate && idem.cachedResponse) {
        return idem.cachedResponse;
      }
    }

    const resolvedLines: Array<{
      variant: any;
      product: any;
      quantity: number;
      unitPrice: number;
    }> = [];

    // Verify stock and anti-overselling (S03)
    for (const item of params.items) {
      const vRes = await db.select().from(shopVariants)
        .where(and(eq(shopVariants.organizationId, context.organizationId), eq(shopVariants.id, item.variantId)))
        .limit(1);

      if (vRes.length === 0) throw new Error("找不到商品規格");
      const variant = vRes[0];

      if (!variant.isActive) {
        throw new Error(`商品規格 ${variant.title} 已下架，無法購買 (S01)`);
      }

      const availableStock = variant.stockQuantity - variant.reservedQuantity;
      if (item.quantity > availableStock) {
        throw new Error(`商品 ${variant.title} 庫存不足！現有可用量 ${availableStock}，欲結帳 ${item.quantity} (S03)`);
      }

      const pRes = await db.select().from(shopProducts).where(and(eq(shopProducts.organizationId, context.organizationId), eq(shopProducts.id, variant.productId), eq(shopProducts.isActive, true))).limit(1);
      if (!pRes.length) throw new Error("商品已下架");

      resolvedLines.push({
        variant,
        product: pRes[0],
        quantity: item.quantity,
        unitPrice: variant.price,
      });
    }

    // Check Coupon (S04)
    let orderDiscount = 0;
    if (params.couponCode) {
      const promoRes = await db.select().from(shopPromotions)
        .where(and(
          eq(shopPromotions.organizationId, context.organizationId),
          eq(shopPromotions.code, params.couponCode)
        ))
        .limit(1);

      if (promoRes.length === 0) {
        throw new Error("優惠券代碼不存在 (S04)");
      }
      const promo = promoRes[0];

      if (promo.expiresAt && new Date(promo.expiresAt) < new Date()) {
        throw new Error("優惠券已過期，無法使用 (S04)");
      }

      if (!promo.isActive) {
        throw new Error("優惠券已停用或失效 (S04)");
      }

      const rawSubtotal = resolvedLines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
      if (rawSubtotal < promo.minSpend) {
        throw new Error(`未達到優惠券最低消費門檻 ${promo.minSpend} (S04)`);
      }

      if (promo.discountType === "percentage") {
        orderDiscount = Math.round((rawSubtotal * promo.discountValue) / 100);
      } else {
        orderDiscount = promo.discountValue;
      }
    }

    // Calculate amounts with strict sequencing
    const calc = calculateOrderAmounts({
      lines: resolvedLines.map((l) => ({
        unitPrice: l.unitPrice,
        quantity: l.quantity,
      })),
      orderDiscount,
      shippingOrServiceFee: 60,
    });

    const orderId = `ord_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const orderNumber = `ORD-${Date.now()}`;

    // Insert order with snapshot of address (S02)
    const statements: any[] = [];
    statements.push(db.insert(shopOrders).values({
      id: orderId,
      organizationId: context.organizationId,
      orderNumber,
      userId: context.userId,
      customerEmail: params.customerEmail,
      shippingAddressJson: JSON.stringify(params.shippingAddress),
      subtotal: calc.subtotal,
      discountAmount: calc.orderDiscountTotal,
      shippingFee: calc.shippingOrServiceFee,
      totalAmount: calc.totalAmount,
      paymentStatus: "pending",
      fulfillmentStatus: "unfulfilled",
      idempotencyKey: params.idempotencyKey || null,
    }));

    // D1 batch is atomic; NOT NULL guard aborts the whole batch on stale stock.
    // Insert items and deduct stock / mark reserved
    for (const rLine of resolvedLines) {
      statements.push(db.insert(shopInventoryReservations).values({ id: crypto.randomUUID(), organizationId: context.organizationId, variantId: rLine.variant.id, sessionId: params.sessionId, cartId: orderId, quantity: rLine.quantity, expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), status: "active" }));
      statements.push(db.insert(shopOrderItems).values({
        id: `oi_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        organizationId: context.organizationId,
        orderId,
        variantId: rLine.variant.id,
        productName: rLine.product?.name || "未知商品",
        variantTitle: rLine.variant.title,
        sku: rLine.variant.sku,
        unitPrice: rLine.unitPrice,
        quantity: rLine.quantity,
        lineTotal: calc.lines[resolvedLines.indexOf(rLine)].netLineTotal,
      }));

      // Deduct stock quantity
      statements.push(db.update(shopVariants).set({
        stockQuantity: sql`CASE WHEN ${shopVariants.stockQuantity} - ${shopVariants.reservedQuantity} >= ${rLine.quantity} THEN ${shopVariants.stockQuantity} - ${rLine.quantity} ELSE NULL END`,
      }).where(and(eq(shopVariants.organizationId, context.organizationId), eq(shopVariants.id, rLine.variant.id))));
    }

    const result = {
      success: true,
      orderId,
      orderNumber,
      subtotal: calc.subtotal,
      discountAmount: calc.orderDiscountTotal,
      shippingFee: calc.shippingOrServiceFee,
      totalAmount: calc.totalAmount,
      paymentStatus: "pending",
    };

    if (params.idempotencyKey) {
      statements.push(db.insert(idempotencyKeys).values({ id: `shop:${context.organizationId}:${context.userId}:${params.idempotencyKey}`, organizationId: context.organizationId, key: params.idempotencyKey, endpoint: "/api/shop/checkout", requestHash: params.idempotencyKey, responseStatus: 200, responseBody: JSON.stringify(result) }));
    }

    try { await db.batch(statements as [any, ...any[]]); } catch (error) {
      if (params.idempotencyKey) { const replay = await checkIdempotency(context, params.idempotencyKey, "/api/shop/checkout"); if (replay.cachedResponse) return replay.cachedResponse; }
      throw new Error("庫存不足或訂單交易衝突，請重新整理後再試");
    }
    return result;
  }

  /**
   * S05: Mock Payment Adapter with callback verification & idempotency
   */
  static async simulatePaymentCallback(context: TenantContext, params: {
    orderId: string;
    attemptReference: string;
    amount: number;
    status: "success" | "failed";
  }) {
    await this.releaseExpiredReservations(context);
    const paymentPermission = checkPermission(context, "operator");
    if (!paymentPermission.allowed) throw new Error(paymentPermission.message);
    const db = getDb();
    const orders = await db.select().from(shopOrders)
      .where(and(eq(shopOrders.organizationId, context.organizationId), eq(shopOrders.id, params.orderId)))
      .limit(1);

    if (orders.length === 0) throw new Error("訂單不存在");
    const order = orders[0];

    if (order.userId !== context.userId && context.role !== "admin") throw new Error("無權操作其他會員訂單");
    if (!["success", "failed"].includes(params.status)) throw new Error("無效付款狀態");
    if (["refunded", "expired"].includes(order.paymentStatus)) throw new Error("已退款或逾時訂單不可再付款，請重新下單");
    // Verify amount match (S05)
    if (params.amount !== order.totalAmount) {
      throw new Error(`金流回呼金額不相符！訂單應付 ${order.totalAmount}，回呼金額 ${params.amount}，疑似偽造，系統拒絕入帳 (S05)`);
    }

    // Duplicate callback check (idempotent)
    if (order.paymentStatus === "paid") {
      return {
        success: true,
        alreadyProcessed: true,
        orderNumber: order.orderNumber,
        status: "paid",
        paymentStatus: "paid",
      };
    }

    const newPaymentStatus = params.status === "success" ? "paid" : "failed";
    await db.batch([
      // Enforce monotonic success inside the transaction, after any racing read.
      db.update(shopOrders).set({ paymentStatus: sql`CASE WHEN ${shopOrders.paymentStatus} = 'paid' THEN 'paid' WHEN ${shopOrders.paymentStatus} IN ('expired', 'refunded') OR EXISTS(SELECT 1 FROM shop_inventory_reservations WHERE cart_id = ${params.orderId} AND status = 'expired') THEN NULL ELSE ${newPaymentStatus} END` }).where(and(eq(shopOrders.organizationId, context.organizationId),eq(shopOrders.id, params.orderId))),
      db.update(shopInventoryReservations).set({status: params.status === "success" ? "consumed" : "active"}).where(and(eq(shopInventoryReservations.organizationId, context.organizationId),eq(shopInventoryReservations.cartId, params.orderId), eq(shopInventoryReservations.status,"active"))),
      db.insert(shopPaymentAttempts).values({ id: crypto.randomUUID(), organizationId: context.organizationId, orderId: params.orderId, attemptReference: params.attemptReference, amount: params.amount, provider: "mock_payment_gateway", status: params.status, callbackPayload: JSON.stringify(params) }),
      ...(params.status === "success" ? [db.insert(outboxEvents).values({ id: `shop.paid:${params.orderId}`, organizationId: context.organizationId, eventType: "shop.paid", payload: JSON.stringify({ orderId: params.orderId }) }).onConflictDoNothing()] : []),
    ]);

    const [persisted] = await db.select({paymentStatus:shopOrders.paymentStatus}).from(shopOrders).where(and(eq(shopOrders.organizationId,context.organizationId),eq(shopOrders.id,params.orderId)));
    if (!persisted) throw new Error("訂單已不存在，請重新整理");
    return {
      success: true,
      orderNumber: order.orderNumber,
      paymentStatus: persisted.paymentStatus,
    };
  }

  /**
   * S06: Ship Order (must be paid, cannot overship)
   */
  static async shipOrder(context: TenantContext, params: {
    orderId: string;
    carrier?: string;
  }) {
    const perm = checkPermission(context, "operator");
    if (!perm.allowed) throw new Error(perm.message);

    const db = getDb();
    const orders = await db.select().from(shopOrders)
      .where(and(eq(shopOrders.organizationId, context.organizationId), eq(shopOrders.id, params.orderId)))
      .limit(1);

    if (orders.length === 0) throw new Error("訂單不存在");
    const order = orders[0];

    if (order.paymentStatus !== "paid") {
      throw new Error("未付款之訂單不得出貨 (S06)");
    }

    if (order.fulfillmentStatus === "shipped") return { success: true, trackingNumber: order.trackingNumber, status: "shipped" };
    const trackingNumber = `TRK-${Date.now()}`;
    try {
      await db.batch([
        db.update(shopOrders).set({fulfillmentStatus:"shipped",trackingNumber}).where(and(eq(shopOrders.id,params.orderId),eq(shopOrders.organizationId,context.organizationId))),
        db.insert(shopShipments).values({id:`shipment:${params.orderId}`,organizationId:context.organizationId,orderId:params.orderId,trackingNumber,carrier:params.carrier || "標準物流 (模擬)",status:"shipped"}),
      ]);
    } catch (error) {
      const [existing] = await db.select().from(shopShipments).where(and(eq(shopShipments.organizationId,context.organizationId),eq(shopShipments.orderId,params.orderId)));
      if (existing) return {success:true,trackingNumber:existing.trackingNumber,status:"shipped"};
      throw error;
    }

    return { success: true, trackingNumber, status: "shipped" };
  }

  /**
   * S07: Return & Refund with stock reversal
   */
  static async refundOrderItem(context: TenantContext, params: {
    orderId: string;
    orderItemId: string;
    quantity: number;
    reason: string;
  }) {
    const perm = checkPermission(context, "admin");
    if (!perm.allowed) throw new Error(perm.message);

    const db = getDb();
    const items = await db.select().from(shopOrderItems)
      .where(and(eq(shopOrderItems.organizationId, context.organizationId), eq(shopOrderItems.id, params.orderItemId)))
      .limit(1);

    if (items.length === 0) throw new Error("找不到訂單商品行");
    const item = items[0];
    if (item.orderId !== params.orderId) throw new Error("商品行不屬於該訂單");
    if (!Number.isSafeInteger(params.quantity) || params.quantity <= 0 || !params.reason?.trim()) throw new Error("退貨須填寫正整數數量與原因");
    const [order] = await db.select().from(shopOrders).where(and(eq(shopOrders.organizationId, context.organizationId), eq(shopOrders.id, params.orderId)));
    if (!order || order.paymentStatus !== "paid") throw new Error("僅已付款訂單可以退款");

    // Check previous returns
    const prevReturns = await db.select().from(shopReturns)
      .where(and(eq(shopReturns.organizationId, context.organizationId), eq(shopReturns.orderItemId, params.orderItemId)));

    const alreadyReturned = prevReturns.reduce((sum, r) => sum + r.quantity, 0);
    const maxRefundable = item.quantity - alreadyReturned;

    if (params.quantity > maxRefundable) {
      throw new Error(`超過可退貨數量拒絕！原購 ${item.quantity}，已退 ${alreadyReturned}，欲退 ${params.quantity} (S07)`);
    }

    const refundAmount = Math.floor(item.lineTotal * (alreadyReturned + params.quantity) / item.quantity) - Math.floor(item.lineTotal * alreadyReturned / item.quantity);
    // Guard the cumulative return amount inside the same atomic D1 batch.
    await db.batch([
      db.update(shopOrderItems).set({ quantity: sql`CASE WHEN ${shopOrderItems.quantity} >= (SELECT COALESCE(SUM(quantity), 0) FROM shop_returns WHERE order_item_id = ${item.id} AND organization_id = ${context.organizationId}) + ${params.quantity} THEN ${shopOrderItems.quantity} ELSE NULL END` }).where(and(eq(shopOrderItems.id, item.id), eq(shopOrderItems.organizationId, context.organizationId))),
      db.insert(shopReturns).values({ id: crypto.randomUUID(), organizationId: context.organizationId, orderId: params.orderId, orderItemId: params.orderItemId, quantity: params.quantity, reason: params.reason.trim(), status: "refunded", refundAmount }),
      db.update(shopVariants).set({ stockQuantity: sql`${shopVariants.stockQuantity} + ${params.quantity}` }).where(and(eq(shopVariants.id, item.variantId), eq(shopVariants.organizationId, context.organizationId))),
    ]);

    return { success: true, refundAmount, refundedQty: params.quantity };
  }

  /**
   * S08: Add Product Review (only verified purchasers)
   */
  static async addReview(context: TenantContext, params: {
    productId: string;
    orderId: string;
    rating: number;
    comment?: string;
  }) {
    const reviewPermission = checkPermission(context, "operator");
    if (!reviewPermission.allowed) throw new Error(reviewPermission.message);
    const db = getDb();
    // Verify purchase
    const orders = await db.select().from(shopOrders)
      .where(and(
        eq(shopOrders.organizationId, context.organizationId),
        eq(shopOrders.id, params.orderId),
        eq(shopOrders.paymentStatus, "paid"),
        eq(shopOrders.userId, context.userId)
      ))
      .limit(1);

    if (orders.length === 0) {
      throw new Error("完成購買之會員方可發表商品評價 (S08)");
    }

    const purchased = await db.select().from(shopOrderItems).innerJoin(shopVariants, eq(shopOrderItems.variantId, shopVariants.id)).where(and(eq(shopOrderItems.organizationId, context.organizationId), eq(shopOrderItems.orderId, params.orderId), eq(shopVariants.productId, params.productId)));
    if (!purchased.length) throw new Error("訂單未購買此商品");
    const previous = await db.select().from(shopReviews).where(and(eq(shopReviews.organizationId, context.organizationId), eq(shopReviews.orderId, params.orderId), eq(shopReviews.productId, params.productId), eq(shopReviews.userId, context.userId)));
    if (previous.length) throw new Error("此商品已評價");
    if (!Number.isInteger(params.rating) || params.rating < 1 || params.rating > 5) throw new Error("評分須為 1 至 5");
    const rating = params.rating;
    const reviewId = `rev_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    await db.insert(shopReviews).values({
      id: reviewId,
      organizationId: context.organizationId,
      productId: params.productId,
      userId: context.userId,
      orderId: params.orderId,
      rating,
      comment: params.comment || null,
      isVisible: true,
    });

    return { success: true, reviewId, rating };
  }
}
