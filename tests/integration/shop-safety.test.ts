import test from "node:test";
import assert from "node:assert/strict";
import { getDb } from "../../db/index";
import { seedOrganization } from "../../lib/seed";
import { ShopService } from "../../lib/services/shop-service";
import { shopOrders, shopOrderItems, shopVariants, shopInventoryReservations } from "../../db/schema";
import { and, eq } from "drizzle-orm";

test("shop rejects invalid carts, atomically prevents concurrent oversell, replays orders and releases expired stock", async () => {
 const context = { organizationId: `shop_safety_${crypto.randomUUID()}`, userId:"buyer",userEmail:"buyer@test.local",userDisplayName:"Buyer", role:"admin" as const, requestId:crypto.randomUUID() };
 await seedOrganization(context.organizationId);
 const db=getDb();
 const {products}=await ShopService.searchProducts(context,{});const variant=products[0].variants.find(v=>v.size==="L")!;
 const input={sessionId:"buyer",customerEmail:"buyer@test.local",shippingAddress:{name:"Buyer",city:"Taipei",address:"Road 1",phone:"0900"},items:[{variantId:variant.id,quantity:1}]};
 await assert.rejects(()=>ShopService.checkoutCart(context,{...input,items:[{variantId:variant.id,quantity:-1}]}),/整數/);
 await assert.rejects(()=>ShopService.checkoutCart(context,{...input,items:[]}),/購物車/);
 const results=await Promise.allSettled([ShopService.checkoutCart(context,{...input,idempotencyKey:"a"}),ShopService.checkoutCart(context,{...input,idempotencyKey:"b"})]);
 assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
 const result=results.find(r=>r.status==="fulfilled") as PromiseFulfilledResult<any>;
 const key=results[0].status==="fulfilled"?"a":"b";
 const replay:any=await ShopService.checkoutCart(context,{...input,idempotencyKey:key});assert.equal(replay.orderId,result.value.orderId);
 const orders=await db.select().from(shopOrders).where(and(eq(shopOrders.organizationId,context.organizationId),eq(shopOrders.userId,context.userId)));assert.equal(orders.length,1);
 await db.update(shopInventoryReservations).set({expiresAt:"2020-01-01T00:00:00.000Z"}).where(eq(shopInventoryReservations.cartId,result.value.orderId));
 await ShopService.releaseExpiredReservations(context);await ShopService.releaseExpiredReservations(context);
 const [stock]=await db.select().from(shopVariants).where(eq(shopVariants.id,variant.id));assert.equal(stock.stockQuantity,1);
 await assert.rejects(()=>ShopService.simulatePaymentCallback(context,{orderId:result.value.orderId,attemptReference:"late",amount:result.value.totalAmount,status:"success"}),/逾時/);
 const [line]=await db.select().from(shopOrderItems).where(eq(shopOrderItems.orderId,result.value.orderId));
 await assert.rejects(()=>ShopService.refundOrderItem(context,{orderId:result.value.orderId,orderItemId:line.id,quantity:1,reason:"test"}),/已付款/);
});
