import { NextRequest } from "next/server";
import { resolveTenantContext } from "@/lib/tenant";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ErpService } from "@/lib/services/erp-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const context = resolveTenantContext(request);
    const body: any = await request.json();

    const result = await ErpService.transferStock(context, {
      itemId: body.itemId,
      fromWarehouseId: body.fromWarehouseId,
      toWarehouseId: body.toWarehouseId,
      quantity: Number(body.quantity || 1),
    });

    return successResponse(result, context.requestId);
  } catch (err: any) {
    return errorResponse("TRANSFER_FAILED", err.message, 400);
  }
}
