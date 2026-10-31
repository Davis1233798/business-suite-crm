import test from "node:test";
import assert from "node:assert";
import { getDb } from "../../db/index.ts";
import { seedOrganization } from "../../lib/seed.ts";
import { CrmService } from "../../lib/services/crm-service.ts";
import { ShopService } from "../../lib/services/shop-service.ts";
import { shopVariants, shopOrders, crmStages, shopOrderItems, shopProducts } from "../../db/schema.ts";
import { eq, and } from "drizzle-orm";

test("P2 CRM Verification: R01 - R08", async () => {
  const orgId = `org_crm_test_${Date.now()}`;
  await seedOrganization(orgId);

  const adminCtx = {
    organizationId: orgId,
    userId: "usr_admin",
    userEmail: "admin@test.local",
    userDisplayName: "CRM Manager",
    role: "admin" as const,
    requestId: "req_crm_admin",
  };

  const operatorCtx = {
    ...adminCtx,
    userId: "usr_sales",
    role: "operator" as const,
    requestId: "req_crm_sales",
  };

  // R01: 聯絡人 (email 重複提示)
  const contactRes = await CrmService.createContact(operatorCtx, {
    name: "張志豪",
    email: "zhihao.zhang@techcorp.test",
    title: "採購副總",
  });
  assert.ok(contactRes.contactId);

  await assert.rejects(
    async () => {
      await CrmService.createContact(operatorCtx, {
        name: "張志豪 (分身)",
        email: "zhihao.zhang@techcorp.test",
      });
    },
    /已存在於聯絡人/
  );

  // R02: 潛客轉換 (一次建立客戶、聯絡人與商機；重送不重複)
  const leadId = `crm_lead_01_${orgId}`;
  const conv1 = await CrmService.convertLead(operatorCtx, {
    leadId,
    dealAmount: 80000,
  });
  assert.ok(conv1.accountId);
  assert.ok(conv1.contactId);
  assert.ok(conv1.opportunityId);

  // Retry convert -> must return alreadyConverted
  const conv2 = await CrmService.convertLead(operatorCtx, { leadId });
  assert.strictEqual(conv2.alreadyConverted, true);
  assert.strictEqual(conv2.opportunityId, conv1.opportunityId);

  // R03: 商機看板 (100,000 x 60% = 60,000 加權金額；成單失單原因)
  const oppId = `crm_opp_01_${orgId}`;
  const stageWon = `crm_stg_05_${orgId}`; // Won stage

  // Won without reason -> must reject (R03)
  await assert.rejects(
    async () => {
      await CrmService.updateOpportunityStage(operatorCtx, {
        opportunityId: oppId,
        stageId: stageWon,
      });
    },
    /結案成交必須填寫成交原因/
  );

  // Stage 3 (方案報價, 60% probability)
  const stg3Res = await CrmService.updateOpportunityStage(operatorCtx, {
    opportunityId: oppId,
    stageId: `crm_stg_03_${orgId}`,
  });
  assert.strictEqual(stg3Res.amount, 100000);
  assert.strictEqual(stg3Res.probability, 60);
  assert.strictEqual(stg3Res.weightedAmount, 60000);

  // R04: 活動完成
  const actId = `crm_act_01_${orgId}`;
  const actRes = await CrmService.completeActivity(operatorCtx, actId);
  assert.strictEqual(actRes.success, true);

  // R05: 報價單核准鎖定 (核准後鎖定；重複核准拒絕)
  const quoteId = `crm_qt_01_${orgId}`; // already locked in seed
  await assert.rejects(
    async () => {
      await CrmService.approveQuote(adminCtx, quoteId);
    },
    /不可重複核准/
  );

  // R06: 客服工單與SLA
  const tckRes = await CrmService.createTicket(operatorCtx, {
    subject: "雲端服務故障報修",
    priority: "urgent",
    slaHours: 12,
  });
  assert.strictEqual(tckRes.slaHours, 12);

  // R07: 行銷同意權過濾
  const recipients = await CrmService.getMarketingRecipients(operatorCtx);
  assert.strictEqual(recipients.length >= 1, true);

  // R08: 銷售漏斗與權限
  const funnel = await CrmService.getSalesFunnel(adminCtx);
  assert.strictEqual(funnel.stages.length, 6);
  assert.strictEqual(funnel.totalPipelineAmount >= 100000, true);
});

test("P2 Shop (MarketLane) Verification: S01 - S08", async () => {
  const orgId = `org_shop_test_${Date.now()}`;
  await seedOrganization(orgId);

  const adminCtx = {
    organizationId: orgId,
    userId: "usr_admin",
    userEmail: "admin@test.local",
    userDisplayName: "Shop Admin",
    role: "admin" as const,
    requestId: "req_shop_admin",
  };

  const buyerCtx = {
    ...adminCtx,
    userId: "usr_buyer_1",
    role: "operator" as const,
    requestId: "req_shop_buyer",
  };

  const db = getDb();

  // S01: 商品與規格搜尋
  const searchRes = await ShopService.searchProducts(buyerCtx, { page: 1, limit: 10 });
  assert.strictEqual(searchRes.products.length >= 1, true);
  const hoodie = searchRes.products[0];
  assert.strictEqual(hoodie.variants.length, 2);

  // S04: 100 x 2 打 9 折 = 180，加運費 60 = 240
  const varBlackM = hoodie.variants.find((v: any) => v.title.includes("M"))!;
  const checkout1: any = await ShopService.checkoutCart(buyerCtx, {
    sessionId: "sess_test_1",
    customerEmail: "buyer1@test.local",
    shippingAddress: { name: "王先生", city: "新北市", address: "板橋區文化路1號", phone: "0911-222-333" },
    items: [{ variantId: varBlackM.id, quantity: 2 }],
    couponCode: "SAVE10", // 10% off
    shippingFee: 60,
  });
  assert.strictEqual(checkout1.subtotal, 200);
  assert.strictEqual(checkout1.discountAmount, 20);
  assert.strictEqual(checkout1.shippingFee, 60);
  assert.strictEqual(checkout1.totalAmount, 240);

  // S04: 過期券拒絕
  await assert.rejects(
    async () => {
      await ShopService.checkoutCart(buyerCtx, {
        sessionId: "sess_test_expired",
        customerEmail: "buyer@test.local",
        shippingAddress: { name: "王先生", city: "新北市", address: "板橋區文化路1號", phone: "0911-222-333" },
        items: [{ variantId: varBlackM.id, quantity: 1 }],
        couponCode: "EXPIRED50",
      });
    },
    /優惠券已過期/
  );

  // S03: 最後一件併發防超賣檢驗 (Variant L has stock = 1 in seed)
  const varBlackL = hoodie.variants.find((v: any) => v.title.includes("L"))!;
  // First checkout succeeds
  const firstBuyerOrder: any = await ShopService.checkoutCart(buyerCtx, {
    sessionId: "sess_buyer_a",
    customerEmail: "buyera@test.local",
    shippingAddress: { name: "買家A", city: "台北市", address: "信義路", phone: "0900" },
    items: [{ variantId: varBlackL.id, quantity: 1 }],
  });
  assert.ok(firstBuyerOrder.orderId);

  // Second checkout for the same last item -> MUST REJECT (S03)
  await assert.rejects(
    async () => {
      await ShopService.checkoutCart(buyerCtx, {
        sessionId: "sess_buyer_b",
        customerEmail: "buyerb@test.local",
        shippingAddress: { name: "買家B", city: "台中市", address: "台灣大道", phone: "0900" },
        items: [{ variantId: varBlackL.id, quantity: 1 }],
      });
    },
    /庫存不足/
  );

  // S05: 模擬金流回呼 (金額不符拒絕、正常回呼入帳、重複回呼冪等)
  // Amount mismatch -> reject
  await assert.rejects(
    async () => {
      await ShopService.simulatePaymentCallback(buyerCtx, {
        orderId: checkout1.orderId,
        attemptReference: "PAY_MOCK_001",
        amount: 999, // actual is 240
        status: "success",
      });
    },
    /金流回呼金額不相符/
  );

  // Valid payment callback
  const payRes = await ShopService.simulatePaymentCallback(buyerCtx, {
    orderId: checkout1.orderId,
    attemptReference: "PAY_MOCK_001",
    amount: 240,
    status: "success",
  });
  assert.strictEqual(payRes.paymentStatus, "paid");

  // Duplicate callback -> idempotent
  const dupPayRes = await ShopService.simulatePaymentCallback(buyerCtx, {
    orderId: checkout1.orderId,
    attemptReference: "PAY_MOCK_001",
    amount: 240,
    status: "success",
  });
  assert.strictEqual(dupPayRes.alreadyProcessed, true);

  // S06: 出貨履約 (未付款禁止出貨；已付可出貨)
  const shipRes = await ShopService.shipOrder(buyerCtx, { orderId: checkout1.orderId });
  assert.strictEqual(shipRes.status, "shipped");
  assert.ok(shipRes.trackingNumber);

  // Attempt ship on unpaid order -> reject (S06)
  await assert.rejects(
    async () => {
      await ShopService.shipOrder(buyerCtx, { orderId: firstBuyerOrder.orderId }); // unpaid
    },
    /未付款之訂單不得出貨/
  );

  // S07: 退貨退款 (超量退貨拒絕；退貨成功補回庫存)
  const orderItems = await db.select().from(shopOrderItems)
    .where(eq(shopOrderItems.orderId, checkout1.orderId));
  const oi = orderItems[0]; // quantity was 2

  // Return 1
  const retRes = await ShopService.refundOrderItem(adminCtx, {
    orderId: checkout1.orderId,
    orderItemId: oi.id,
    quantity: 1,
    reason: "尺寸不合換貨",
  });
  assert.strictEqual(retRes.refundedQty, 1);

  // Cumulative over-refund: original 2, returned 1, trying to return 2 -> reject (S07)
  await assert.rejects(
    async () => {
      await ShopService.refundOrderItem(adminCtx, {
        orderId: checkout1.orderId,
        orderItemId: oi.id,
        quantity: 2,
        reason: "超退",
      });
    },
    /超過可退貨數量拒絕/
  );

  // S08: 評價 (完成購買方可評價)
  const reviewRes = await ShopService.addReview(buyerCtx, {
    productId: hoodie.id,
    orderId: checkout1.orderId,
    rating: 5,
    comment: "剪裁立體，防潑水性能極佳！",
  });
  assert.strictEqual(reviewRes.rating, 5);

  // Unpaid order cannot review
  await assert.rejects(
    async () => {
      await ShopService.addReview(buyerCtx, {
        productId: hoodie.id,
        orderId: firstBuyerOrder.orderId,
        rating: 4,
      });
    },
    /完成購買之會員方可發表商品評價/
  );
});
