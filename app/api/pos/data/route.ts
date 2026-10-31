import { NextRequest } from "next/server";
import { resolveTenantContext } from "@/lib/tenant";
import { successResponse, errorResponse } from "@/lib/api-response";
import { getDb } from "@/db/index";
import { eq, and, sql } from "drizzle-orm";
import {
  posStores,
  posRegisters,
  posShifts,
  posCatalogItems,
  posSales,
  posSaleLines,
  posHeldCarts,
} from "@/db/schema";
import { PosService } from "@/lib/services/pos-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = resolveTenantContext(request);
    const db = getDb();
    const orgId = context.organizationId;

    const [stores, registers, shifts, catalogItems, sales, heldCarts, saleLines] = await Promise.all([
      db.select().from(posStores).where(eq(posStores.organizationId, orgId)),
      db.select().from(posRegisters).where(eq(posRegisters.organizationId, orgId)),
      db.select().from(posShifts).where(eq(posShifts.organizationId, orgId)),
      db.select().from(posCatalogItems).where(eq(posCatalogItems.organizationId, orgId)),
      db.select().from(posSales).where(eq(posSales.organizationId, orgId)).orderBy(sql`rowid DESC`),
      db.select().from(posHeldCarts).where(and(eq(posHeldCarts.organizationId, orgId), eq(posHeldCarts.status, "held"))),
      db.select().from(posSaleLines).where(eq(posSaleLines.organizationId, orgId)),
    ]);

    const activeStore = stores[0];
    const dailyReport = activeStore
      ? await PosService.getDailyReport(context, activeStore.id)
      : null;

    return successResponse({
      stores,
      registers,
      shifts,
      catalogItems,
      sales,
      heldCarts,
      saleLines,
      dailyReport,
    }, context.requestId);
  } catch (err: any) {
    return errorResponse("FETCH_POS_FAILED", err.message, 500);
  }
}
