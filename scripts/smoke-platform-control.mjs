import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const base=process.argv[2]??'http://127.0.0.1:8090';
if (!['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname)) throw new Error('Use a local connection or SSH tunnel for this collector restart test');
let stored={};
try {stored=Object.fromEntries(readFileSync('infra/.env','utf8').split(/\r?\n/).filter(s=>s.includes('=')).map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)];}));} catch {}
const token=process.env.PLATFORM_TOKEN??stored.PLATFORM_TOKEN;
const gateway=process.env.GATEWAY_TOKEN??stored.GATEWAY_TOKEN;
assert.ok(token,'Configure a dedicated PLATFORM_TOKEN');
async function request(operation,body,credential=token) {
  const response=await fetch(base+'/api/platform/control/'+operation,{method:body?'POST':'GET',headers:{...(credential?{authorization:'Bearer '+credential}:{}),cookie:'demo_user_role=admin','content-type':'application/json'},body:body?JSON.stringify(body):undefined});
  return {status:response.status,value:await response.json()};
}
assert.equal((await request('status',undefined,'')).status,401);
assert.equal((await request('status',undefined,gateway)).status,401);
const before=await request('status');assert.equal(before.status,200);
assert.ok(before.value.services.some(s=>s.service==='collector'&&s.state==='running'));
assert.ok(!JSON.stringify(before.value).includes(token));
assert.equal((await request('plan',{site:'erp',service:'collector',action:'stop'})).status,400);
assert.equal((await request('plan',{site:'mes',service:'host-shell',action:'exec'})).status,400);
const stale=await request('plan',{site:'mes',service:'collector',action:'start'});assert.equal(stale.status,200);
const planned=await request('plan',{site:'mes',service:'collector',action:'restart'});assert.equal(planned.status,200);
assert.deepEqual(planned.value.affected_sites,['mes']);
const applied=await request('apply',{plan_id:planned.value.plan_id});assert.equal(applied.status,200);
assert.equal(applied.value.services.find(s=>s.service==='collector').state,'running');
assert.equal((await request('apply',{plan_id:planned.value.plan_id})).status,410);
assert.equal((await request('apply',{plan_id:stale.value.plan_id})).status,409);
console.log('PASS: dedicated operator auth, declared service scope, live status, non-mutating plans, collector restart, replay and state-drift rejection');
