import { NextRequest } from "next/server";
import { resolveTenantContext } from "@/lib/tenant";
import { infrastructureConfigured, infrastructureRequest } from "@/lib/infrastructure";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const context = resolveTenantContext(request);
    if (!infrastructureConfigured()) return Response.json({ status: "not_configured", message: "尚未設定工業服務連線；請設定 INFRA_GATEWAY_URL 與服務憑證。" }, { status: 503 });
    const tenant=encodeURIComponent(context.organizationId);
    const [data,production]=await Promise.all([
      infrastructureRequest<{measurements:unknown[]}>(`/industrial/${tenant}`),
      infrastructureRequest<{workOrders:unknown[];source:string}>(`/mes/${tenant}/work-orders`),
    ]);
    return Response.json({...data,...production}, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ status: "unavailable", message: "工作階段失效或工業服務暫時無法使用。" }, { status: 503 });
  }
}
