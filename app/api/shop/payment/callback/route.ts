import { NextRequest } from "next/server";
import { resolveTenantContext } from "@/lib/tenant";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ShopService } from "@/lib/services/shop-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const context = resolveTenantContext(request);
    const body: any = await request.json();

    const result = await ShopService.simulatePaymentCallback(context, {
      orderId: body.orderId,
      attemptReference: body.attemptReference || `PAY_${Date.now()}`,
      amount: Number(body.amount || 0),
      status: body.status || "success",
    });

    return successResponse(result, context.requestId);
  } catch (err: any) {
    return errorResponse("PAYMENT_CALLBACK_FAILED", err.message, 400);
  }
}
