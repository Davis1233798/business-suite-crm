import { eq, and, sql } from "drizzle-orm";
import { getDb } from "../../db/index";
import {
  mesProducts,
  mesBomVersions,
  mesBomItems,
  mesWorkCenters,
  mesWorkOrders,
  mesOperations,
  mesMaterialLots,
  mesWorkOrderMaterials,
  mesProductionReports,
  mesQualityChecks,
  mesDowntimeEvents,
  idempotencyKeys,
  auditEvents,
} from "../../db/schema";
import { TenantContext, checkPermission } from "../tenant";
import { recordAuditEvent } from "../audit";
import { calculateOee } from "../money";
import { checkIdempotency, saveIdempotency } from "../idempotency";

function mesGuard(context: TenantContext, condition: ReturnType<typeof sql>, action: string, entityId: string, details: unknown) {
  return getDb().insert(auditEvents).values({id: crypto.randomUUID(), organizationId: context.organizationId, actorId: sql`CASE WHEN ${condition} THEN ${context.userId} ELSE NULL END`, actorRole: context.role, action, entityType: "mes", entityId, afterValue: JSON.stringify(details), requestId: context.requestId});
}
function count(value: number, name: string, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${name}必須是${minimum ? "正" : "非負"}整數`);
}
function utc(value: string) {
  const source = value.includes("T") ? value : `${value.replace(" ", "T")}:00+08:00`;
  if (!Number.isFinite(Date.parse(source))) throw new Error("日期格式錯誤");
  return new Date(source).toISOString();
}

export class MesService {
  /**
   * M01: Create BOM Version with circular reference detection
   */
  static async createBomVersion(context: TenantContext, params: {
    productId: string;
    version: number;
    items: Array<{ materialSku: string; materialName: string; quantityPerUnit: number }>;
    notes?: string;
  }) {
    const perm = checkPermission(context, "operator");
    if (!perm.allowed) throw new Error(perm.message);

    const db = getDb();
    const prodRes = await db.select().from(mesProducts)
      .where(and(eq(mesProducts.organizationId, context.organizationId), eq(mesProducts.id, params.productId)))
      .limit(1);

    if (prodRes.length === 0) throw new Error("成品不存在");
    const product = prodRes[0];
    count(params.version, "BOM版本", 1);
    if (!Array.isArray(params.items) || !params.items.length || params.items.length > 100) throw new Error("BOM必須包含1至100項物料");
    if (new Set(params.items.map(i => i.materialSku)).size !== params.items.length) throw new Error("BOM原料SKU不可重複");
    for (const item of params.items) {count(item.quantityPerUnit, "單位用量", 1); if (!item.materialSku.trim() || !item.materialName.trim()) throw new Error("請填寫原料SKU及名稱");}

    // Circular BOM detection (M01): product cannot consume itself
    for (const item of params.items) {
      if (item.materialSku === product.sku) {
        throw new Error(`BOM 循環引照拒絕！成品 ${product.sku} 不能以自身作為耗用原料 (M01)`);
      }
    }

    const bomId = crypto.randomUUID();
    const conditions = [sql`NOT EXISTS (SELECT 1 FROM mes_bom_versions WHERE organization_id = ${context.organizationId} AND product_id = ${product.id} AND version = ${params.version})`];
    for (const item of params.items) conditions.push(sql`NOT EXISTS (WITH RECURSIVE dependencies(sku) AS (SELECT ${item.materialSku} UNION SELECT bi.material_sku FROM dependencies d JOIN mes_products p ON p.sku = d.sku AND p.organization_id = ${context.organizationId} JOIN mes_bom_versions b ON b.product_id = p.id AND b.organization_id = ${context.organizationId} AND b.is_active = 1 JOIN mes_bom_items bi ON bi.bom_version_id = b.id AND bi.organization_id = ${context.organizationId}) SELECT 1 FROM dependencies WHERE sku = ${product.sku})`);
    const queries: any[] = [mesGuard(context, sql.join(conditions, sql` AND `), "MES_BOM", bomId, params)];
    queries.push(db.insert(mesBomVersions).values({
      id: bomId,
      organizationId: context.organizationId,
      productId: params.productId,
      version: params.version,
      status: "active",
      isActive: true,
      notes: params.notes || null,
    }));

    for (const item of params.items) {
      queries.push(db.insert(mesBomItems).values({
        id: `bomi_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        organizationId: context.organizationId,
        bomVersionId: bomId,
        materialSku: item.materialSku,
        materialName: item.materialName,
        quantityPerUnit: item.quantityPerUnit,
      }));
    }
    try {await db.batch(queries as any);} catch(error) {throw new Error("BOM 循環引照拒絕或版本已存在 (M01)", {cause: error});}

    return { success: true, bomId, version: params.version };
  }

  /**
   * M03: Start Work Order (checks materials staged; draft -> released -> in_progress)
   */
  static async startWorkOrder(context: TenantContext, workOrderId: string) {
    const perm = checkPermission(context, "operator");
    if (!perm.allowed) throw new Error(perm.message);

    const db = getDb();
    const woRes = await db.select().from(mesWorkOrders)
      .where(and(eq(mesWorkOrders.organizationId, context.organizationId), eq(mesWorkOrders.id, workOrderId)))
      .limit(1);

    if (woRes.length === 0) throw new Error("工單不存在");
    const wo = woRes[0];

    // Check material staging (M03)
    if (!wo.materialsStaged) {
      throw new Error("備料未完成 (領料未齊套)，工單不得開工 (M03)");
    }

    if (wo.status !== "released") throw new Error("只有已下達工單可以開工；工單已結案或未下達不得變更狀態 (M03)");

    await db.batch([mesGuard(context, sql`EXISTS (SELECT 1 FROM mes_work_orders WHERE id = ${wo.id} AND organization_id = ${context.organizationId} AND status = 'released' AND materials_staged = 1)`, "MES_START", wo.id, {previousStatus: wo.status, status: "in_progress"}), db.update(mesWorkOrders).set({
      status: "in_progress",
    }).where(and(eq(mesWorkOrders.id, workOrderId), eq(mesWorkOrders.organizationId, context.organizationId)))]);

    return { success: true, status: "in_progress" };
  }

  /**
   * M04: Production Reporting with Good/Scrap, Anti-overfill & Idempotency
   */
  static async reportProduction(context: TenantContext, params: {
    workOrderId: string;
    operationId: string;
    goodQuantity: number;
    scrapQuantity: number;
    notes?: string;
    idempotencyKey?: string;
  }) {
    const perm = checkPermission(context, "operator");
    if (!perm.allowed) throw new Error(perm.message);

    const db = getDb();

    // Idempotency check (M04 / C06)
    if (params.idempotencyKey) {
      const idem = await checkIdempotency(context, params.idempotencyKey, "/api/mes/report");
      if (idem.isDuplicate && idem.cachedResponse) {
        return idem.cachedResponse;
      }
    }

    const woRes = await db.select().from(mesWorkOrders)
      .where(and(eq(mesWorkOrders.organizationId, context.organizationId), eq(mesWorkOrders.id, params.workOrderId)))
      .limit(1);

    if (woRes.length === 0) throw new Error("工單不存在");
    const wo = woRes[0];

    if (wo.status === "closed") throw new Error("工單已結案，嚴格禁止修改或追加報工 (M03)");
    const operation = await db.select().from(mesOperations).where(and(eq(mesOperations.organizationId, context.organizationId), eq(mesOperations.id, params.operationId), eq(mesOperations.workOrderId, params.workOrderId))).limit(1);
    if (!operation.length) throw new Error("製程不屬於此工單");
    if (![params.goodQuantity, params.scrapQuantity].every(q => Number.isSafeInteger(q) && q >= 0) || params.goodQuantity + params.scrapQuantity === 0) throw new Error("數量不得為負數；須為整數且總量大於零");

    if (params.goodQuantity < 0 || params.scrapQuantity < 0) {
      throw new Error("報工良品與報廢數量不得為負數 (M04)");
    }

    const currentReported = wo.completedQuantity + wo.scrappedQuantity;
    const batchTotal = params.goodQuantity + params.scrapQuantity;

    if (currentReported + batchTotal > wo.targetQuantity) {
      throw new Error(`超量報工拒絕！工單目標 ${wo.targetQuantity}，已報工 ${currentReported}，本次報工 ${batchTotal} (M04)`);
    }

    if (wo.status !== "in_progress") throw new Error("只有已開工工單可以報工 (M03)");
    const newCompleted = wo.completedQuantity + params.goodQuantity;
    const newScrapped = wo.scrappedQuantity + params.scrapQuantity;
    const newStatus = (newCompleted + newScrapped) >= wo.targetQuantity ? "completed" : "in_progress";

    const queries: any[] = [db.update(mesWorkOrders).set({
      completedQuantity: sql`${mesWorkOrders.completedQuantity} + ${params.goodQuantity}`,
      scrappedQuantity: sql`${mesWorkOrders.scrappedQuantity} + ${params.scrapQuantity}`,
      status: sql`CASE WHEN ${mesWorkOrders.completedQuantity} + ${mesWorkOrders.scrappedQuantity} + ${batchTotal} >= ${mesWorkOrders.targetQuantity} THEN 'completed' ELSE 'in_progress' END`,
    }).where(and(eq(mesWorkOrders.organizationId, context.organizationId), eq(mesWorkOrders.id, params.workOrderId)))];

    const reportId = `rep_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    queries.push(db.insert(mesProductionReports).values({
      id: reportId,
      organizationId: context.organizationId,
      workOrderId: params.workOrderId,
      operationId: params.operationId,
      operatorId: context.userId,
      goodQuantity: params.goodQuantity,
      scrapQuantity: params.scrapQuantity,
      notes: params.notes || null,
      idempotencyKey: params.idempotencyKey || null,
    }));

    const result = {
      success: true,
      reportId,
      goodQuantity: params.goodQuantity,
      scrapQuantity: params.scrapQuantity,
      totalCompleted: newCompleted,
      totalScrapped: newScrapped,
      orderStatus: newStatus,
    };

    if (params.idempotencyKey) {
      queries.push(db.insert(idempotencyKeys).values({ id: crypto.randomUUID(), organizationId: context.organizationId, key: params.idempotencyKey, endpoint: "/api/mes/report", requestHash: params.idempotencyKey, responseStatus: 200, responseBody: JSON.stringify(result) }));
    }

    try { await db.batch(queries as any); } catch (error) {
      if (params.idempotencyKey) { const replay = await checkIdempotency(context, params.idempotencyKey, "/api/mes/report"); if (replay.isDuplicate) return replay.cachedResponse; }
      throw error;
    }
    return result;
  }

  /**
   * M05: Issue and Return Material with lot tracking
   */
  static async issueAndReturnMaterial(context: TenantContext, params: {
    workOrderId: string;
    materialLotId: string;
    issuedQty: number;
    returnedQty: number;
  }) {
    const perm = checkPermission(context, "operator");
    if (!perm.allowed) throw new Error(perm.message);

    const db = getDb();
    count(params.issuedQty, "領料數量", 1);
    count(params.returnedQty, "退料數量");
    const [workOrder] = await db.select().from(mesWorkOrders).where(and(eq(mesWorkOrders.id, params.workOrderId), eq(mesWorkOrders.organizationId, context.organizationId))).limit(1);
    if (!workOrder || workOrder.status === "closed") throw new Error("工單不存在或已結案，不可領退料");
    const lotRes = await db.select().from(mesMaterialLots)
      .where(and(eq(mesMaterialLots.organizationId, context.organizationId), eq(mesMaterialLots.id, params.materialLotId)))
      .limit(1);

    if (lotRes.length === 0) throw new Error("找不到物料批次");
    const lot = lotRes[0];
    if (lot.status !== "available") throw new Error("物料批次已隔離或不可使用");
    const [requirement] = await db.select().from(mesBomItems).where(and(eq(mesBomItems.organizationId, context.organizationId), eq(mesBomItems.bomVersionId, workOrder.bomVersionId), eq(mesBomItems.materialSku, lot.materialSku))).limit(1);
    if (!requirement) throw new Error("物料SKU不在工單綁定的BOM版本中");

    if (params.issuedQty > lot.currentQuantity) {
      throw new Error(`批次庫存不足拒絕！批次現有 ${lot.currentQuantity}，欲領取 ${params.issuedQty} (M05)`);
    }

    if (params.returnedQty > params.issuedQty) {
      throw new Error("退料數量不得大於領料數量 (M05)");
    }

    const netQty = params.issuedQty - params.returnedQty;

    // Deduct net quantity from lot
    const womId = `wom_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    await db.batch([
      mesGuard(context, sql`EXISTS (SELECT 1 FROM mes_work_orders WHERE id = ${workOrder.id} AND organization_id = ${context.organizationId} AND status != 'closed' AND bom_version_id = ${workOrder.bomVersionId}) AND EXISTS (SELECT 1 FROM mes_material_lots WHERE id = ${lot.id} AND organization_id = ${context.organizationId} AND status = 'available' AND current_quantity >= ${params.issuedQty})`, "MES_MATERIAL", womId, params),
      db.update(mesMaterialLots).set({currentQuantity: sql`${mesMaterialLots.currentQuantity} - ${netQty}`}).where(and(eq(mesMaterialLots.id, lot.id), eq(mesMaterialLots.organizationId, context.organizationId))),
      db.insert(mesWorkOrderMaterials).values({
      id: womId,
      organizationId: context.organizationId,
      workOrderId: params.workOrderId,
      materialLotId: params.materialLotId,
      materialSku: lot.materialSku,
      issuedQuantity: params.issuedQty,
      returnedQuantity: params.returnedQty,
      netQuantity: netQty,
    }),
      db.update(mesWorkOrders).set({materialsStaged: sql`CASE WHEN NOT EXISTS (SELECT 1 FROM mes_bom_items b WHERE b.organization_id = ${context.organizationId} AND b.bom_version_id = ${workOrder.bomVersionId} AND b.quantity_per_unit * ${workOrder.targetQuantity} > COALESCE((SELECT SUM(m.net_quantity) FROM mes_work_order_materials m WHERE m.organization_id = ${context.organizationId} AND m.work_order_id = ${workOrder.id} AND m.material_sku = b.material_sku), 0)) THEN 1 ELSE 0 END`}).where(eq(mesWorkOrders.id, workOrder.id)),
    ]);
    const [updatedLot] = await db.select().from(mesMaterialLots).where(eq(mesMaterialLots.id, lot.id));

    return {
      success: true,
      materialSku: lot.materialSku,
      issuedQuantity: params.issuedQty,
      returnedQuantity: params.returnedQty,
      netQuantity: netQty,
      lotRemaining: updatedLot.currentQuantity,
    };
  }

  /**
   * M06: Quality Check & Quarantine
   */
  static async recordQualityCheck(context: TenantContext, params: {
    workOrderId: string;
    reportId?: string;
    sampleQuantity: number;
    failedQuantity: number;
    disposition?: "quarantine" | "release" | "rework";
    notes?: string;
  }) {
    const perm = checkPermission(context, "operator");
    if (!perm.allowed) throw new Error(perm.message);

    count(params.sampleQuantity, "抽檢樣本", 1);
    count(params.failedQuantity, "不合格數量");
    if (params.disposition && !["quarantine", "release", "rework"].includes(params.disposition)) throw new Error("品檢處置無效");
    if (params.failedQuantity > 0 && params.disposition === "release") throw new Error("不合格樣本不可直接放行");
    const passedQuantity = params.sampleQuantity - params.failedQuantity;
    if (passedQuantity < 0) {
      throw new Error("不合格數量不能大於抽檢樣本總量");
    }

    const status = params.failedQuantity > 0 ? "quarantined" : "passed";
    const disposition = params.failedQuantity > 0 ? (params.disposition || "quarantine") : "release";

    const db = getDb();
    const [wo] = await db.select().from(mesWorkOrders).where(and(eq(mesWorkOrders.organizationId, context.organizationId), eq(mesWorkOrders.id, params.workOrderId))).limit(1);
    if (!wo || wo.status === "closed") throw new Error("工單不存在或已結案，不可新增品檢");
    if (params.sampleQuantity > wo.completedQuantity + wo.scrappedQuantity) throw new Error("抽檢樣本不得超過工單已報工數量");
    if (params.reportId) {
      const [report] = await db.select().from(mesProductionReports).where(and(eq(mesProductionReports.organizationId, context.organizationId), eq(mesProductionReports.id, params.reportId), eq(mesProductionReports.workOrderId, wo.id))).limit(1);
      if (!report || params.sampleQuantity > report.goodQuantity + report.scrapQuantity) throw new Error("報工單不屬於此工單或抽檢數量超過報工數量");
    }
    const checkId = `qc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    await db.batch([mesGuard(context, sql`EXISTS (SELECT 1 FROM mes_work_orders WHERE id = ${wo.id} AND organization_id = ${context.organizationId} AND status != 'closed' AND completed_quantity + scrapped_quantity >= ${params.sampleQuantity})`, "MES_QUALITY", checkId, params), db.insert(mesQualityChecks).values({
      id: checkId,
      organizationId: context.organizationId,
      workOrderId: params.workOrderId,
      reportId: params.reportId || null,
      inspectorId: context.userId,
      sampleQuantity: params.sampleQuantity,
      passedQuantity,
      failedQuantity: params.failedQuantity,
      status,
      disposition,
      notes: params.notes || null,
    })]);

    return { success: true, checkId, status, disposition, passedQuantity, failedQuantity: params.failedQuantity };
  }

  /**
   * M07: Record Downtime & prevent overlapping intervals
   */
  static async recordDowntime(context: TenantContext, params: {
    workCenterId: string;
    startTime: string; // ISO or YYYY-MM-DD HH:mm
    endTime?: string;
    reason: string;
  }) {
    const perm = checkPermission(context, "operator");
    if (!perm.allowed) throw new Error(perm.message);

    const db = getDb();
    if (!params.reason.trim() || params.reason.length > 500) throw new Error("請填寫有效停機原因");
    const [center] = await db.select().from(mesWorkCenters).where(and(eq(mesWorkCenters.id, params.workCenterId), eq(mesWorkCenters.organizationId, context.organizationId))).limit(1);
    if (!center) throw new Error("工作中心不存在");
    params = {...params, startTime: utc(params.startTime), endTime: params.endTime ? utc(params.endTime) : undefined};
    if (params.endTime && params.endTime <= params.startTime) throw new Error("停機結束時間必須晚於開始時間");

    // Prevent active overlapping ongoing downtime
    const ongoing = await db.select().from(mesDowntimeEvents)
      .where(and(
        eq(mesDowntimeEvents.organizationId, context.organizationId),
        eq(mesDowntimeEvents.workCenterId, params.workCenterId),
        sql`(${mesDowntimeEvents.endTime} IS NULL OR julianday(${mesDowntimeEvents.endTime}) > julianday(${params.startTime}))`,
        sql`(${params.endTime || null} IS NULL OR julianday(${mesDowntimeEvents.startTime}) < julianday(${params.endTime || null}))`
      ))
      .limit(1);

    if (ongoing.length > 0) {
      throw new Error("同設備已有尚未修復之開放停機事件，停機區間不得重疊 (M07)");
    }

    const dtId = `dt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const overlapGuard = sql`NOT EXISTS (SELECT 1 FROM mes_downtime_events WHERE organization_id = ${context.organizationId} AND work_center_id = ${params.workCenterId} AND (end_time IS NULL OR julianday(end_time) > julianday(${params.startTime})) AND (${params.endTime || null} IS NULL OR julianday(start_time) < julianday(${params.endTime || null})))`;
    try {await db.batch([mesGuard(context, overlapGuard, "MES_DOWNTIME", dtId, params), db.insert(mesDowntimeEvents).values({
      id: dtId,
      organizationId: context.organizationId,
      workCenterId: params.workCenterId,
      startTime: params.startTime,
      endTime: params.endTime || null,
      reason: params.reason,
      reporterId: context.userId,
      durationMinutes: params.endTime ? Math.round((Date.parse(params.endTime) - Date.parse(params.startTime)) / 60000) : 0,
      status: params.endTime ? "resolved" : "ongoing",
    })]);} catch(error) {throw new Error("停機區間不得重疊 (M07)", {cause: error});}

    return { success: true, downtimeId: dtId };
  }

  /**
   * M08: OEE Metrics calculation
   */
  static getOeeMetrics(params: {
    plannedMinutes: number;
    operatingMinutes: number;
    idealCycleMinutesPerUnit: number;
    totalPieces: number;
    goodPieces: number;
  }) {
    return calculateOee(params);
  }
}
