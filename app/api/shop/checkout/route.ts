import { NextRequest } from "next/server";
import { resolveTenantContext } from "@/lib/tenant";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ShopService } from "@/lib/services/shop-service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const context = resolveTenantContext(request);
    const body: any = await request.json();

    const result = await ShopService.checkoutCart(context, {
      sessionId: body.sessionId || "client_session",
      customerEmail: body.customerEmail || "customer@sites.test",
      shippingAddress: body.shippingAddress || {
        name: "李先生",
        city: "台北市",
        address: "敦化南路二段",
        phone: "0912-345-678",
      },
      items: body.items,
      couponCode: body.couponCode,
      shippingFee: body.shippingFee ?? 60,
      idempotencyKey: body.idempotencyKey,
    });

    return successResponse(result, context.requestId);
  } catch (err: any) {
    return errorResponse("CHECKOUT_FAILED", err.message, 400);
  }
}
