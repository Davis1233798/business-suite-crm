import { NextRequest } from "next/server";
import { resolveTenantContext, checkPermission } from "@/lib/tenant";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ShopService } from "@/lib/services/shop-service";
export async function POST(request: NextRequest) {
 const context = resolveTenantContext(request);
 try {
 const body: any = await request.json();
 const permission = checkPermission(context, body.action === "refund" || body.action === "ship" ? "admin" : "operator");
 if (!permission.allowed) return errorResponse("FORBIDDEN", permission.message!, 403, undefined, context.requestId);
 let result;
 switch (body.action) {
 case "checkout": result = await ShopService.checkoutCart(context, { ...body, sessionId: context.userId, shippingFee: 60 }); break;
 case "payment": result = await ShopService.simulatePaymentCallback(context, body); break;
 case "ship": result = await ShopService.shipOrder(context, body); break;
 case "refund": result = await ShopService.refundOrderItem(context, body); break;
 case "review": result = await ShopService.addReview(context, body); break;
 default: throw new Error("不支援的操作");
 }
 return successResponse(result, context.requestId);
 } catch (e) { return errorResponse("SHOP_ACTION_FAILED", e instanceof Error ? e.message : "操作失敗", 400, undefined, context.requestId); }
}
