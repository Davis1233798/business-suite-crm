import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const base = process.argv[2] ?? 'http://127.0.0.1:8787';
if (!['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname)) throw new Error('This creates isolated demo transactions; use a local preview only.');
let cookie = '';
async function call(path, body) {
  const response = await fetch(base + path, {method:body ? 'POST' : 'GET', headers:{cookie,...(body ? {'content-type':'application/json'} : {})},body:body ? JSON.stringify(body) : undefined});
  const session = response.headers.getSetCookie().find(v => v.startsWith('demo_session_id='));
  if (session) cookie = session.split(';')[0];
  const json = await response.json();
  assert.equal(response.ok,true,JSON.stringify(json));
  return json.data;
}
await call('/api/health');
const catalog = await call('/api/shop/data');
const order = await call('/api/shop/checkout',{items:[{variantId:catalog.products[0].variants[0].id,quantity:1}],idempotencyKey:crypto.randomUUID()});
await call('/api/shop/payment/callback',{orderId:order.orderId,amount:order.totalAmount,status:'success',attemptReference:crypto.randomUUID()});
const token = readFileSync('infra/.env','utf8').split(/\r?\n/).find(s=>s.startsWith('GATEWAY_TOKEN=')).slice('GATEWAY_TOKEN='.length);
const denied = await fetch(base + '/api/platform/dispatch', {method:'POST'});
assert.equal(denied.status,401,'Demo identity must not authorize infrastructure operations');
if (!process.argv.includes('--timer')) {
  const trigger = await fetch(base + '/api/platform/dispatch', {method:'POST',headers:{authorization:`Bearer ${token}`}});
  assert.equal(trigger.ok,true,'Service-only dispatch failed');
}
const tenant = 'org_' + cookie.split('=')[1];
const code = `import os,time,psycopg,sys
from runtime.policy import shard_for
tenant=sys.argv[1]
for i in range(180):
 with psycopg.connect(os.environ[f'SHARD_{shard_for(tenant)}_URL']) as db:
  count=db.execute('SELECT count(*) FROM fulfillment_jobs WHERE tenant_id=%s',(tenant,)).fetchone()[0]
 if count==1: break
 time.sleep(.5)
assert count==1, 'Web outbox was not delivered'
print('PASS: Web payment -> D1-compatible Outbox -> service dispatch -> RabbitMQ -> PostgreSQL fulfillment job')
`;
const result = spawnSync('docker',['compose','--project-directory','infra','-f','infra/compose.yaml','exec','-T','gateway','python','-',tenant],{input:code,encoding:'utf8'});
process.stdout.write(result.stdout ?? '');
if (result.status !== 0) throw new Error(result.stderr);
