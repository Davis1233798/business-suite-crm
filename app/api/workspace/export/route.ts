import { NextRequest } from "next/server";
import { resolveTenantContext } from "@/lib/tenant";
import { exportWorkspaceCsv } from "@/lib/tenant-backup";
import { errorResponse } from "@/lib/api-response";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const context = resolveTenantContext(request);
  const table = request.nextUrl.searchParams.get("table") || "pos_sales";
  try { return new Response(await exportWorkspaceCsv(context, table), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${table.replace(/[^a-z_]/g, "")}.csv"`, "cache-control": "no-store", "x-request-id": context.requestId } }); }
  catch (error: any) { return errorResponse("EXPORT_FAILED", error.message, 400, undefined, context.requestId); }
}
