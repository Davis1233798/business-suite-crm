import { NextRequest } from "next/server";
import { resolveTenantContext } from "@/lib/tenant";
import { successResponse, errorResponse } from "@/lib/api-response";
import { ShopService } from "@/lib/services/shop-service";
import { getDb } from "@/db/index";
import { shopCategories, shopOrders, shopOrderItems, shopReturns, shopReviews } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
 const context = resolveTenantContext(request);
 try {
 const db = getDb(); const q = request.nextUrl.searchParams;
 const catalog = await ShopService.searchProducts(context, { keyword: q.get("q") || undefined, categoryId: q.get("category") || undefined, minPrice: q.has("min") ? Number(q.get("min")) : undefined, maxPrice: q.has("max") ? Number(q.get("max")) : undefined, page: Number(q.get("page") || 1), limit: 50 });
 const manager = q.get("management") === "1" && context.role === "admin";
 const orders = await db.select().from(shopOrders).where(and(eq(shopOrders.organizationId, context.organizationId), manager ? undefined : eq(shopOrders.userId, context.userId))).orderBy(desc(shopOrders.createdAt)).limit(100);
 const allItems = await db.select().from(shopOrderItems).where(eq(shopOrderItems.organizationId, context.organizationId));
 const allReturns = await db.select().from(shopReturns).where(eq(shopReturns.organizationId, context.organizationId));
 const ids = new Set(orders.map((o: {id:string}) => o.id));
 const categories = await db.select().from(shopCategories).where(eq(shopCategories.organizationId, context.organizationId));
 const returns = allReturns.filter((r: {orderId:string}) => ids.has(r.orderId));
 const reviews = await db.select().from(shopReviews).where(and(eq(shopReviews.organizationId, context.organizationId), eq(shopReviews.isVisible, true)));
 return successResponse({ ...catalog, categories, orders, items: allItems.filter((i: {orderId:string}) => ids.has(i.orderId)), returns, reviews, role: context.role, netRevenue: orders.filter((o: {paymentStatus:string}) => o.paymentStatus === "paid").reduce((n:number,o:{totalAmount:number}) => n + o.totalAmount,0) - returns.reduce((n:number,r:{refundAmount:number}) => n+r.refundAmount,0) }, context.requestId);
 } catch (e) { return errorResponse("SHOP_LOAD_FAILED", e instanceof Error ? e.message : "載入失敗", 400, undefined, context.requestId); }
}
