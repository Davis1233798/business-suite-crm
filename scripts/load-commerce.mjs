/** Bounded loopback-only workload. Creates its own demo tenant, never resets data. */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const base=process.argv[2]??'http://127.0.0.1:8090';
const mixed=process.argv.includes('--mixed-payments');
assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname),'Run on host loopback or SSH tunnel');
let cookie='';
const measurements=[];
async function request(path,body) {
  const start=performance.now();
  const response=await fetch(base+path,{method:body?'POST':'GET',headers:{cookie,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10_000)});
  const session=response.headers.getSetCookie().find(v=>v.startsWith('demo_session_id='));
  if(session)cookie=session.split(';')[0];
  const value=await response.json();
  return {status:response.status,value,ms:performance.now()-start};
}
async function burst(name,total,concurrency,operation,accepted) {
  let next=0; const results=[]; const start=performance.now();
  await Promise.all(Array.from({length:concurrency},async()=>{
    while(next<total){const index=next++;results.push(await operation(index));}
  }));
  const duration=performance.now()-start;
  const times=results.map(r=>r.ms).sort((a,b)=>a-b);
  const unexpected=results.filter(r=>!accepted.includes(r.status));
  const report={name,requests:total,concurrency,durationMs:Math.round(duration),requestsPerSecond:Math.round(total/duration*1000),p50Ms:Math.round(times[Math.ceil(total*.5)-1]),p95Ms:Math.round(times[Math.ceil(total*.95)-1]),maxMs:Math.round(times.at(-1)),statuses:Object.fromEntries([...new Set(results.map(r=>r.status))].map(status=>[status,results.filter(r=>r.status===status).length]))};
  measurements.push(report);
  assert.equal(unexpected.length,0,JSON.stringify({report,errors:unexpected.slice(0,2)}));
  // Explicit scope: this single-host bounded workload, not a production capacity promise.
  assert.ok(report.p95Ms<2000,`${name} p95 exceeds the 2 second local workload threshold`);
  return results;
}
assert.equal((await request('/api/health')).status,200);
const initial=await request('/api/shop/data?management=1'); assert.equal(initial.status,200);
assert.ok(cookie,'A private demo session must be established before concurrency begins');
const baselineOrders=initial.value.data.orders.length;
const variant=initial.value.data.products.flatMap(p=>p.variants).find(v=>v.stockQuantity>0&&v.stockQuantity<=999&&v.reservedQuantity===0);
assert.ok(variant,'Need a seeded stock-bearing variant');
const tenant='org_'+cookie.split('=')[1];
await burst('warm catalog',256,32,()=>request('/api/shop/data'),[200]);
const payload={items:[{variantId:variant.id,quantity:variant.stockQuantity}]};
const attempts=await burst('competing for final available stock',16,16,()=>request('/api/shop/checkout',{...payload,idempotencyKey:crypto.randomUUID()}),[200,400]);
const accepted=attempts.filter(r=>r.status===200);
assert.equal(accepted.length,1,'Exactly one competing buyer may reserve the full remaining stock');
const order=accepted[0].value.data;
const remaining=await request('/api/shop/data');
assert.equal(remaining.value.data.products.flatMap(p=>p.variants).find(v=>v.id===variant.id).stockQuantity,0,'Cached descriptions must not hide the live stock deduction');
await burst(mixed?'mixed success/failure payment callbacks':'duplicate successful payment callbacks',32,16,i=>request('/api/shop/payment/callback',{orderId:order.orderId,amount:order.totalAmount,status:mixed&&i%2?'failed':'success',attemptReference:'load-duplicate-'+i}),[200]);
const sqliteCode=`import{DatabaseSync}from'node:sqlite';
const db=new DatabaseSync('.data/portfolio.sqlite',{readOnly:true});
const [tenant,order,baseline]=process.argv.slice(2);
const count=db.prepare("SELECT count(*) AS n FROM outbox_events WHERE organization_id=? AND event_type='shop.paid' AND id=?").get(tenant,'shop.paid:'+order).n;
const orders=db.prepare('SELECT count(*) AS n FROM shop_orders WHERE organization_id=?').get(tenant).n;
const state=db.prepare('SELECT payment_status FROM shop_orders WHERE organization_id=? AND id=?').get(tenant,order).payment_status;
const unconsumed=db.prepare("SELECT count(*) AS n FROM shop_inventory_reservations WHERE organization_id=? AND cart_id=? AND status!='consumed'").get(tenant,order).n;
if(count!==1||orders!==Number(baseline)+1||state!=='paid'||unconsumed!==0)throw new Error(JSON.stringify({error:'Payment or checkout invariant violated',count,orders,state,unconsumed,expectedOrders:Number(baseline)+1}));
console.log('PASS: one new order, paid state, consumed reservation and one atomic payment event after concurrent writes');db.close();`;
function compose(service,program,args,code){
  const result=spawnSync('docker',['compose','--project-directory','infra','-f','infra/compose.yaml','-f','infra/linux/compose.web.yaml','exec','-T',service,...program,...args],{input:code,encoding:'utf8',timeout:110_000});
  assert.equal(result.status,0,result.stderr);process.stdout.write(result.stdout??'');
}
compose('web',['node','--input-type=module','-'],[tenant,order.orderId,String(baselineOrders)],sqliteCode);
const deliveryCode=`import os,time,psycopg,sys,json,hashlib
from runtime.policy import shard_for,cache_key
import redis
tenant,order=sys.argv[1:]
key=hashlib.sha256(b'{"page":1,"limit":50}').hexdigest()
cache=redis.Redis.from_url(os.environ['REDIS_URL'],decode_responses=True)
catalog=json.loads(cache.get(cache_key(tenant,{'key':key})) or 'null')
assert isinstance(catalog,list) and catalog, 'Real catalog descriptors must be present in Redis'
assert all('stockQuantity' not in row and 'price' not in row for row in catalog)
for i in range(180):
 with psycopg.connect(os.environ[f'SHARD_{shard_for(tenant)}_URL']) as db:
  count=db.execute('SELECT count(*) FROM fulfillment_jobs WHERE tenant_id=%s AND order_id=%s',(tenant,order)).fetchone()[0]
 if count:break
 time.sleep(.5)
assert count==1,'Automatic Outbox timer must produce one fulfillment job'
print('PASS: Redis descriptor cache, live stock, automatic RabbitMQ delivery and one PostgreSQL fulfillment job')
`;
compose('gateway',['python','-'],[tenant,order.orderId],deliveryCode);
const receipt={scope:'Single Linux host, loopback, one isolated tenant, warmed catalog, no TLS, not a maximum-capacity test',at:new Date().toISOString(),thresholds:{p95Ms:2000,unexpectedResponses:0},checks:['256 catalog reads / 32 concurrent','16 full-stock competitors / one accepted order / zero remaining stock',mixed?'32 mixed success/failure callbacks / final paid state / consumed reservation / one Outbox event':'32 duplicate payment callbacks / one Outbox event','automatic timer -> RabbitMQ -> one PostgreSQL fulfillment job'],measurements};
writeFileSync(process.env.LOAD_RECEIPT??'commerce-load-receipt.json',JSON.stringify(receipt,null,2));
console.log(JSON.stringify(receipt,null,2));
