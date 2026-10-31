import assert from "node:assert/strict";
const base = process.argv[2] || "http://127.0.0.1:5173";
function client() {
  let cookie = "";
  return async (path, body, role) => {
    const response = await fetch(base + path, { method: body ? "POST" : "GET", headers: { ...(cookie ? { cookie: cookie + (role ? `; demo_user_role=${role}` : "") } : {}), ...(body ? { "content-type":"application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const session = response.headers.getSetCookie().find(v=>v.startsWith("demo_session_id=")); if (session) cookie = session.split(";")[0];
    const responseText = await response.text();
    let json; try { json = JSON.parse(responseText); } catch { throw new Error(`${path}: HTTP ${response.status}: ${responseText.slice(0,250)}`); }
    if (role === "readonly" && body) { assert.equal(response.status,403); return; }
    assert.equal(response.ok,true,`${path}: ${JSON.stringify(json)}`); assert.equal(json.success,true,`${path}: ${JSON.stringify(json)}`);
    return json.data;
  };
}
const request = client(), other = client();
await request("/api/health");
const modules = {};
for (const name of ["mes","erp","pos","crm","dining","shop"]) modules[name] = await request(`/api/${name}/data`);
const pos = modules.pos, item = pos.catalogItems[0], shift = pos.shifts.find(s=>s.status === "open");
const payment = {storeId:pos.stores[0].id,registerId:pos.registers[0].id,shiftId:shift.id,items:[{barcode:item.barcode,quantity:2,lineDiscount:10}],tenderAmount:200,idempotencyKey:crypto.randomUUID()};
const sale = await request("/api/pos/checkout",payment);
assert.equal(sale.totalAmount,190); assert.equal(sale.changeAmount,10);
assert.equal((await request("/api/pos/checkout",payment)).saleId,sale.saleId);
const privatePos = await other("/api/pos/data");
assert.equal(privatePos.sales.length,0); assert.notEqual(privatePos.catalogItems[0].id,item.id);
await request("/api/pos/checkout",payment,"readonly");
const mes = modules.mes, wo = mes.workOrders.find(w=>w.materialsStaged && w.status !== "closed"), operation = mes.operations.find(o=>o.workOrderId===wo.id);
if (wo.status === "released") await request("/api/operations/mes",{action:"status",workOrderId:wo.id,status:"in_progress"});
const report = await request("/api/mes/report",{workOrderId:wo.id,operationId:operation.id,goodQuantity:1,scrapQuantity:0,idempotencyKey:crypto.randomUUID()});
assert.equal(report.goodQuantity,1);
await request("/api/operations/mes",{action:"create",productId:mes.products[0].id,targetQuantity:10});
const erp = modules.erp;
await request("/api/operations/erp",{action:"purchase",supplierId:erp.suppliers[0].id,itemId:erp.items[0].id,quantity:2,unitPrice:100});
const crm = modules.crm;
const lead = crm.leads.find(l=>l.status !== "converted");
if (lead) assert.ok((await request("/api/crm/lead/convert",{leadId:lead.id,dealAmount:10000})).opportunityId);
const dining = modules.dining, table = dining.tables.find(t=>t.status === "vacant");
const session = await request("/api/dining/session",{tableId:table.id,guestCount:1});
const dish = dining.menuItems.find(m=>!m.isSoldOut && m.category !== "飲品");
const order = await request("/api/dining/order",{sessionToken:session.sessionToken,items:[{menuItemId:dish.id,quantity:1}],idempotencyKey:crypto.randomUUID()});
assert.ok(order.orderId);
const shop = modules.shop, variant = shop.products.flatMap(p=>p.variants).find(v=>v.stockQuantity>0);
const checkout = await request("/api/shop/action",{action:"checkout",items:[{variantId:variant.id,quantity:1}],customerEmail:"smoke@example.test",shippingAddress:{name:"測試顧客",phone:"0900000000",city:"台北市",address:"展示測試地址 1 號",postalCode:"100"},idempotencyKey:crypto.randomUUID()});
assert.ok(checkout.orderId);
await request("/api/shop/action",{action:"payment",orderId:checkout.orderId,amount:checkout.totalAmount,attemptReference:crypto.randomUUID(),status:"success"});
await request("/api/shop/action",{action:"ship",orderId:checkout.orderId});
console.log(JSON.stringify({base,status:"PASS",checks:["six data APIs","POS 190/200/change10","checkout replay","visitor isolation","readonly 403","MES report and new work order","ERP new purchase","CRM lead conversion","dining table and order","shop checkout/payment/shipment"]},null,2));
