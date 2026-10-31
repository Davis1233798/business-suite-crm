import test from "node:test";
import assert from "node:assert";
import { getDb } from "../../db/index.ts";
import { seedOrganization } from "../../lib/seed.ts";
import { DiningService } from "../../lib/services/dining-service.ts";
import { MesService } from "../../lib/services/mes-service.ts";
import { diningTableSessions, diningTables, diningOrders, diningKitchenTickets, mesWorkOrders, mesOperations, mesMaterialLots } from "../../db/schema.ts";
import { eq, and } from "drizzle-orm";

test("P3 Dining (TableCraft) Verification: D01 - D08", async () => {
  const orgId = `org_din_test_${Date.now()}`;
  await seedOrganization(orgId);

  const adminCtx = {
    organizationId: orgId,
    userId: "usr_admin",
    userEmail: "admin@test.local",
    userDisplayName: "Dining Manager",
    role: "admin" as const,
    requestId: "req_din_admin",
  };

  const staffCtx = {
    ...adminCtx,
    userId: "usr_waiter",
    role: "operator" as const,
    requestId: "req_din_staff",
  };

  const db = getDb();
  const sessionToken = `token_tbl_a2_${orgId}`;

  // D01: 售完商品強制拒絕下單
  const soldOutItemId = `din_menu_04_${orgId}`;
  await assert.rejects(
    async () => {
      await DiningService.placeOrder(staffCtx, {
        sessionToken,
        items: [{ menuItemId: soldOutItemId, quantity: 1 }],
      });
    },
    /已售完/
  );

  // D01: 必選甜度未填不得點餐 (飲品)
  const beverageId = `din_menu_03_${orgId}`; // 手熬黑糖珍珠鮮奶
  await assert.rejects(
    async () => {
      await DiningService.placeOrder(staffCtx, {
        sessionToken,
        items: [{ menuItemId: beverageId, quantity: 1 }], // no modifier selected
      });
    },
    /必須選擇「甜度/
  );

  // D01 & D04: 正確下單 (加料加價入帳 + 10%服務費)
  // 牛奶 100 + 珍珠 10 = 110
  const sweetGroup = `din_modg_01_${orgId}`;
  const toppingGroup = `din_modg_02_${orgId}`;
  const optSweet = `din_modo_02_${orgId}`; // 微糖 (+$0)
  const optTopping = `din_modo_04_${orgId}`; // 珍珠 (+$10)

  const orderRes: any = await DiningService.placeOrder(staffCtx, {
    sessionToken,
    items: [
      {
        menuItemId: beverageId,
        quantity: 1,
        modifiers: [
          { groupId: sweetGroup, optionId: optSweet },
          { groupId: toppingGroup, optionId: optTopping },
        ],
      },
    ],
    idempotencyKey: "din_idem_001",
  });

  assert.strictEqual(orderRes.subtotal, 110);
  assert.strictEqual(orderRes.serviceCharge, 11); // 10% of 110 = 11
  assert.strictEqual(orderRes.finalAmount, 121);

  // D02: 桌位預約 (人數超限提示、重複時段衝突拒絕)
  const tblB1 = `din_tbl_b1_${orgId}`; // capacity is 2
  await assert.rejects(
    async () => {
      await DiningService.reserveTable(staffCtx, {
        tableId: tblB1,
        customerName: "陳先生",
        customerPhone: "0922-000-111",
        guestCount: 5, // exceeds capacity 2
        reservationTime: "2026-10-30 19:00",
      });
    },
    /超過此桌容納上限/
  );

  const res1 = await DiningService.reserveTable(staffCtx, {
    tableId: tblB1,
    customerName: "陳先生",
    customerPhone: "0922-000-111",
    guestCount: 2,
    reservationTime: "2026-10-30 19:00",
  });
  assert.ok(res1.reservationId);

  // Duplicate time reservation -> reject (D02)
  await assert.rejects(
    async () => {
      await DiningService.reserveTable(staffCtx, {
        tableId: tblB1,
        customerName: "林小姐",
        customerPhone: "0933-111-222",
        guestCount: 2,
        reservationTime: "2026-10-30 19:00",
      });
    },
    /已有預約/
  );

  // D05: KDS 廚房出餐狀態機 (不可倒退或跳過受限狀態)
  const tickets = await db.select().from(diningKitchenTickets)
    .where(and(eq(diningKitchenTickets.organizationId, orgId)));
  const ticket = tickets[0];
  assert.strictEqual(ticket.status, "received");

  // Attempt jump to served -> reject
  await assert.rejects(
    async () => {
      await DiningService.updateKdsTicketStatus(staffCtx, {
        ticketId: ticket.id,
        newStatus: "served", // must go received -> cooking -> done -> served
      });
    },
    /非法狀態流轉/
  );

  // Normal flow: received -> cooking -> done -> served
  await DiningService.updateKdsTicketStatus(staffCtx, { ticketId: ticket.id, newStatus: "cooking" });
  await DiningService.updateKdsTicketStatus(staffCtx, { ticketId: ticket.id, newStatus: "done" });
  await DiningService.updateKdsTicketStatus(staffCtx, { ticketId: ticket.id, newStatus: "served" });

  // D07: 分單結帳 (10% 服務費，分單合計必須相等)
  const session = await db.select().from(diningTableSessions)
    .where(eq(diningTableSessions.sessionToken, sessionToken))
    .limit(1);

  // We had the seed order (300) + additional beverage order (110) = 410, 10% fee = 41 -> total 451
  // Let's split 451 into 2 payments: 251 and 200
  const splitPay = await DiningService.splitAndPayBill(staffCtx, {
    sessionId: session[0].id,
    splits: [
      { splitIndex: 1, amount: 251, paymentMethod: "cash" },
      { splitIndex: 2, amount: 200, paymentMethod: "credit_card" },
    ],
  });
  assert.strictEqual(splitPay.finalAmount, 451);
  assert.strictEqual(splitPay.paidSplits, 2);

  // D03: 結帳後舊 Token 不能追加點餐
  await assert.rejects(
    async () => {
      await DiningService.placeOrder(staffCtx, {
        sessionToken,
        items: [{ menuItemId: `din_menu_02_${orgId}`, quantity: 1 }],
      });
    },
    /原QR碼已失效/
  );
});

test("P3 MES (ForgeFlow) Verification: M01 - M08", async () => {
  const orgId = `org_mes_test_${Date.now()}`;
  await seedOrganization(orgId);

  const adminCtx = {
    organizationId: orgId,
    userId: "usr_admin",
    userEmail: "admin@test.local",
    userDisplayName: "Plant Manager",
    role: "admin" as const,
    requestId: "req_mes_admin",
  };

  const operatorCtx = {
    ...adminCtx,
    userId: "usr_operator",
    role: "operator" as const,
    requestId: "req_mes_op",
  };

  const db = getDb();
  const prodId = `mes_prd_01_${orgId}`; // SKU: PRD-AL-HEAT

  // M01: BOM 循環引照檢驗 (產品不能以自己為原料)
  await assert.rejects(
    async () => {
      await MesService.createBomVersion(operatorCtx, {
        productId: prodId,
        version: 2,
        items: [{ materialSku: "PRD-AL-HEAT", materialName: "自身循環成品", quantityPerUnit: 1 }],
      });
    },
    /BOM 循環引照拒絕/
  );

  // M03: 工單開工 (未備料不得開工)
  const unstagedWoId = `wo_unstaged_${Date.now()}`;
  await db.insert(mesWorkOrders).values({
    id: unstagedWoId,
    organizationId: orgId,
    orderNo: "WO-UNSTAGED-01",
    productId: prodId,
    bomVersionId: `mes_bom_v1_${orgId}`,
    targetQuantity: 50,
    materialsStaged: false, // NOT staged!
    status: "draft",
  });

  await assert.rejects(
    async () => {
      await MesService.startWorkOrder(operatorCtx, unstagedWoId);
    },
    /備料未完成/
  );

  // Staged work order in seed (WO-202610-001)
  const stagedWoId = `mes_wo_01_${orgId}`;
  const startRes = await MesService.startWorkOrder(operatorCtx, stagedWoId);
  assert.strictEqual(startRes.status, "in_progress");

  // M04: 現場報工 (良品90、報廢10 => 完工數100；超量拒絕；負數拒絕；冪等性)
  const opId = `mes_op_01_${orgId}`;

  // Negative quantity reject
  await assert.rejects(
    async () => {
      await MesService.reportProduction(operatorCtx, {
        workOrderId: stagedWoId,
        operationId: opId,
        goodQuantity: -10,
        scrapQuantity: 0,
      });
    },
    /數量不得為負數/
  );

  // Report 90 good + 10 scrap = 100
  const repRes: any = await MesService.reportProduction(operatorCtx, {
    workOrderId: stagedWoId,
    operationId: opId,
    goodQuantity: 90,
    scrapQuantity: 10,
    idempotencyKey: "mes_rep_001",
  });
  assert.strictEqual(repRes.totalCompleted, 90);
  assert.strictEqual(repRes.totalScrapped, 10);
  assert.strictEqual(repRes.orderStatus, "completed");

  // Overfill reporting attempt -> reject (M04)
  await assert.rejects(
    async () => {
      await MesService.reportProduction(operatorCtx, {
        workOrderId: stagedWoId,
        operationId: opId,
        goodQuantity: 5,
        scrapQuantity: 0,
      });
    },
    /超量報工拒絕/
  );

  // M05: 領退料 (領200，退10 => 淨耗190；批次不足拒絕)
  const lotId = `mes_lot_01_${orgId}`; // has 300
  const matRes = await MesService.issueAndReturnMaterial(operatorCtx, {
    workOrderId: stagedWoId,
    materialLotId: lotId,
    issuedQty: 200,
    returnedQty: 10,
  });
  assert.strictEqual(matRes.issuedQuantity, 200);
  assert.strictEqual(matRes.returnedQuantity, 10);
  assert.strictEqual(matRes.netQuantity, 190);

  // Over-issue lot
  await assert.rejects(
    async () => {
      await MesService.issueAndReturnMaterial(operatorCtx, {
        workOrderId: stagedWoId,
        materialLotId: lotId,
        issuedQty: 500, // lot only has remaining 200
        returnedQty: 0,
      });
    },
    /批次庫存不足/
  );

  // M06: 品檢不合格進入隔離 (Quarantine)
  const qcRes = await MesService.recordQualityCheck(operatorCtx, {
    workOrderId: stagedWoId,
    sampleQuantity: 10,
    failedQuantity: 2, // 2 defective items
    disposition: "quarantine",
  });
  assert.strictEqual(qcRes.status, "quarantined");
  assert.strictEqual(qcRes.disposition, "quarantine");

  // M07: 停機事件不得重疊
  const wcId = `mes_wc_01_${orgId}`;
  const dt1 = await MesService.recordDowntime(operatorCtx, {
    workCenterId: wcId,
    startTime: "2026-10-30 10:00",
    reason: "刀具磨損更換",
  });
  assert.ok(dt1.downtimeId);

  // Overlapping ongoing downtime -> reject
  await assert.rejects(
    async () => {
      await MesService.recordDowntime(operatorCtx, {
        workCenterId: wcId,
        startTime: "2026-10-30 10:30",
        reason: "重複停機通報",
      });
    },
    /停機區間不得重疊/
  );

  // M08: OEE 精確計算 (排程480分、運轉360分、理論1分/件、總量300、良品270 => OEE=56.25%)
  const oee = MesService.getOeeMetrics({
    plannedMinutes: 480,
    operatingMinutes: 360,
    idealCycleMinutesPerUnit: 1,
    totalPieces: 300,
    goodPieces: 270,
  });
  assert.strictEqual(oee.availabilityPercent, 75);
  assert.strictEqual(oee.qualityPercent, 90);
  assert.strictEqual(oee.oeePercent, 56.25);
});
