import { NextRequest } from "next/server";
import { resolveTenantContext, checkPermission } from "@/lib/tenant";
import { seedOrganization } from "@/lib/seed";
import { successResponse, errorResponse } from "@/lib/api-response";
import { getDb } from "@/db/index";
import * as schema from "@/db/schema";
import { eq, getTableColumns } from "drizzle-orm";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const context = resolveTenantContext(request);
  if (!checkPermission(context, "admin").allowed) return errorResponse("FORBIDDEN", "只有示範管理員可以重置自己的展示資料", 403, undefined, context.requestId);
  try {
    const db = getDb();
    // Clear old deliveries first; MES deletion triggers must retain their tombstone events.
    const queries = [db.delete(schema.outboxEvents).where(eq(schema.outboxEvents.organizationId,context.organizationId)), ...Object.values(schema).filter(table=>table!==schema.outboxEvents).flatMap(table => {
      const columns = getTableColumns(table);
      return "organizationId" in columns ? [db.delete(table).where(eq(columns.organizationId, context.organizationId))] : [];
    })];
    if (queries.length) await db.batch(queries as any);
    await seedOrganization(context.organizationId);
    return successResponse({ message: "自己的展示資料已重置", organizationId: context.organizationId }, context.requestId);
  } catch (error: any) {
    return errorResponse("RESET_FAILED", error.message, 500, undefined, context.requestId);
  }
}
