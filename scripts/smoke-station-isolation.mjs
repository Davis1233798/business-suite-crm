/** Destructive-to-runtime test: stop/start each named station, always recover it. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const base=process.argv[2]??'http://127.0.0.1:8090';
assert.ok(['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname),'Use localhost or SSH tunnel');
let stored={};
try { stored=Object.fromEntries(readFileSync('infra/.env','utf8').split(/\r?\n/).filter(s=>s.includes('=')).map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)];})); } catch {}
const token=process.env.PLATFORM_TOKEN??stored.PLATFORM_TOKEN;
assert.ok(token,'Dedicated operator token required');
const stations=['mes','erp','pos','crm','dining','shop'];
const records={mes:'workOrders',erp:'items',pos:'catalogItems',crm:'leads',dining:'tables',shop:'products'};
let cookie='';
async function get(path) {
  const response=await fetch(base+path,{headers:{cookie},signal:AbortSignal.timeout(35_000)});
  const session=response.headers.getSetCookie().find(v=>v.startsWith('demo_session_id='));
  if(session) cookie=session.split(';')[0];
  const text=await response.text();
  return {response,text};
}
async function control(operation,body) {
  const response=await fetch(base+'/api/platform/control/'+operation,{
    method:body?'POST':'GET', headers:{authorization:'Bearer '+token,'content-type':'application/json'},
    body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(120_000),
  });
  const value=await response.json();
  assert.equal(response.status,200,JSON.stringify(value));
  return value;
}
async function operate(site,action) {
  const plan=await control('plan',{site,service:'web-'+site,action});
  if(plan.steps.length) assert.deepEqual(plan.affected_sites,[site]);
  return control('apply',{plan_id:plan.plan_id});
}
await get('/api/health');
const identifiers={};
for (const site of stations) {
  const {response,text}=await get('/api/'+site+'/data');
  assert.equal(response.status,200,text);
  assert.equal(response.headers.get('x-suite-station'),site);
  identifiers[site]=JSON.parse(text).data[records[site]][0].id;
}
for (const site of stations) {
  try {
    await operate(site,'stop');
    assert.equal((await get('/'+site)).response.status,503,'Stopped station page must not fall back to main');
    assert.equal((await get('/api/'+site+'/data')).response.status,503);
    if(site==='shop') assert.equal((await get('/commerce')).response.status,503,'Commerce admin belongs to the shop runtime');
    assert.equal((await get('/platform')).response.status,200);
    for (const other of stations.filter(s=>s!==site)) {
      const {response,text}=await get('/api/'+other+'/data');
      assert.equal(response.status,200,text);
      assert.equal(response.headers.get('x-suite-station'),other);
      assert.equal(JSON.parse(text).data[records[other]][0].id,identifiers[other]);
    }
  } finally { await operate(site,'start'); }
  const {response,text}=await get('/api/'+site+'/data');
  assert.equal(response.status,200,text);
  assert.equal(JSON.parse(text).data[records[site]][0].id,identifiers[site],'Data must persist across station stop/start');
  if(site==='shop') assert.equal((await get('/commerce')).response.headers.get('x-suite-station'),'shop');
  console.log('PASS: '+site+' stop/start isolated; five other stations and main remain available; data preserved');
}
