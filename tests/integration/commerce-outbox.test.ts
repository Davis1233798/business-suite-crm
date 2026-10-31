import test from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../db/index";
import { outboxEvents, shopOrders, shopInventoryReservations } from "../../db/schema";
import { seedOrganization } from "../../lib/seed";
import { ShopService } from "../../lib/services/shop-service";
import { dispatchCommerceOutbox } from "../../lib/commerce-outbox";

test("paid orders atomically create one fulfillment event; callback replay cannot duplicate it", async () => {
  const context = { organizationId: `outbox_${crypto.randomUUID()}`, userId: 'buyer', userEmail: 'buyer@test.local', userDisplayName: 'Buyer', role: 'admin' as const, requestId: crypto.randomUUID() };
  await seedOrganization(context.organizationId);
  const {products} = await ShopService.searchProducts(context, {});
  const order = await ShopService.checkoutCart(context, { sessionId: 'buyer', customerEmail: context.userEmail, shippingAddress: {name:'Buyer',city:'Taipei',address:'Road',phone:'0900'}, items: [{ variantId: products[0].variants[0].id, quantity:1 }] });
  const db = getDb();
  const events = () => db.select().from(outboxEvents).where(and(eq(outboxEvents.organizationId, context.organizationId), eq(outboxEvents.eventType, 'shop.paid')));
  assert.equal((await events()).length, 0);
  await assert.rejects(() => ShopService.simulatePaymentCallback(context, { orderId: order.orderId, attemptReference:'bad', amount:1, status:'success' }));
  assert.equal((await events()).length, 0);
  const callback = { orderId: order.orderId, attemptReference:'paid', amount:order.totalAmount, status:'success' as const };
  await ShopService.simulatePaymentCallback(context, callback);
  await ShopService.simulatePaymentCallback(context, callback);
  const rows = await events();
  assert.equal(rows.length, 1);
  assert.equal(JSON.parse(rows[0].payload).orderId, order.orderId);
  assert.deepEqual(await dispatchCommerceOutbox(), { configured:false, sent:0 });
  assert.equal((await events())[0].status, 'pending');
});

test('concurrent success and failure callbacks cannot downgrade a paid order or reactivate its stock reservation',async()=>{
  const context={organizationId:'payment_race_'+crypto.randomUUID(),userId:'buyer',userEmail:'buyer@test.local',userDisplayName:'Buyer',role:'admin' as const,requestId:crypto.randomUUID()};
  await seedOrganization(context.organizationId);
  const {products}=await ShopService.searchProducts(context,{});
  const order=await ShopService.checkoutCart(context,{sessionId:'buyer',customerEmail:context.userEmail,shippingAddress:{name:'Buyer',city:'Taipei',address:'Road',phone:'0900'},items:[{variantId:products[0].variants[0].id,quantity:1}]});
  await Promise.all(Array.from({length:20},(_,i)=>ShopService.simulatePaymentCallback(context,{orderId:order.orderId,amount:order.totalAmount,attemptReference:'race-'+i,status:i%2?'failed':'success'})));
  const db=getDb();
  const [stored]=await db.select().from(shopOrders).where(eq(shopOrders.id,order.orderId));
  assert.equal(stored.paymentStatus,'paid');
  const reservations=await db.select().from(shopInventoryReservations).where(eq(shopInventoryReservations.cartId,order.orderId));
  assert.ok(reservations.every(r=>r.status==='consumed'));
  const events=await db.select().from(outboxEvents).where(and(eq(outboxEvents.organizationId,context.organizationId),eq(outboxEvents.eventType,'shop.paid')));
  assert.equal(events.length,1);
});
