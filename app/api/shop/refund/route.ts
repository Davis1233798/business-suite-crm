import { NextRequest } from "next/server";
import { resolveTenantContext } from "@/lib/tenant";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ShopService } from "@/lib/services/shop-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const context = resolveTenantContext(request);
    const body: any = await request.json();

    const result = await ShopService.refundOrderItem(context, {
      orderId: body.orderId,
      orderItemId: body.orderItemId,
      quantity: Number(body.quantity || 1),
      reason: body.reason || "售後瑕疵退貨",
    });

    return successResponse(result, context.requestId);
  } catch (err: any) {
    return errorResponse("REFUND_FAILED", err.message, 400);
  }
}
