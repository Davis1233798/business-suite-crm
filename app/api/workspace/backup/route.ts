import { NextRequest } from "next/server";
import { resolveTenantContext, checkPermission } from "@/lib/tenant";
import { exportWorkspace, restoreWorkspace } from "@/lib/tenant-backup";
import { successResponse, errorResponse } from "@/lib/api-response";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const context = resolveTenantContext(request);
  try { return new Response(JSON.stringify(await exportWorkspace(context), null, 2), { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": 'attachment; filename="business-suite-backup.json"', "cache-control": "no-store", "x-request-id": context.requestId } }); }
  catch (error: any) { return errorResponse("EXPORT_FAILED", error.message, 500, undefined, context.requestId); }
}
export async function POST(request: NextRequest) {
  const context = resolveTenantContext(request);
  if (!checkPermission(context, "admin").allowed) return errorResponse("FORBIDDEN", "還原需要示範管理員角色", 403, undefined, context.requestId);
  try {
    if (Number(request.headers.get("content-length") || 0) > 5_000_000) return errorResponse("TOO_LARGE", "備份檔案上限 5 MB", 413, undefined, context.requestId);
    const text = await request.text();
    if (text.length > 5_000_000) return errorResponse("TOO_LARGE", "備份檔案上限 5 MB", 413, undefined, context.requestId);
    return successResponse(await restoreWorkspace(context, JSON.parse(text)), context.requestId);
  } catch (error: any) { return errorResponse("RESTORE_FAILED", error.message, 400, undefined, context.requestId); }
}
