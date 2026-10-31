import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { cachedCatalog, infrastructureConfigured, infrastructureRequest, runWithInfrastructure } from '../../lib/infrastructure';

test('infrastructure configuration stays request scoped, catalog caches descriptors and fails open', async () => {
  let stored: unknown = null;
  const server = createServer(async (req,res) => {
    if (req.headers.authorization !== 'Bearer test-token') { res.writeHead(401).end(); return; }
    if (req.method === 'PUT') {
      let text = ''; for await (const chunk of req) text += chunk;
      stored = JSON.parse(text).value;
      res.end('{}');
    } else { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({value:stored})); }
  });
  server.listen(0, '127.0.0.1');
  await once(server,'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const config = {INFRA_GATEWAY_URL:`http://127.0.0.1:${address.port}`,INFRA_GATEWAY_TOKEN:'test-token'};
  try {
    assert.equal(infrastructureConfigured(), false);
    await runWithInfrastructure(config, async () => {
      let loads = 0;
      const load = async () => { loads++; return [{id:'p1',name:'Product'}]; };
      assert.deepEqual(await cachedCatalog('a',{},load), [{id:'p1',name:'Product'}]);
      assert.deepEqual(await cachedCatalog('a',{},load), [{id:'p1',name:'Product'}]);
      assert.equal(loads,1);
      await Promise.all([
        runWithInfrastructure({}, async () => { await Promise.resolve(); assert.equal(infrastructureConfigured(),false); }),
        Promise.resolve().then(() => assert.equal(infrastructureConfigured(),true)),
      ]);
    });
    await runWithInfrastructure({...config, INFRA_GATEWAY_TOKEN:'invalid'}, async () => {
      assert.deepEqual(await cachedCatalog('a',{},async()=>[{id:'fallback'}]),[{id:'fallback'}]);
      await assert.rejects(() => infrastructureRequest('/cache/a/test'), /401/);
    });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('a cold catalog burst shares one load, isolates credentials and retries after a failed fill', async () => {
  const server = createServer((req,res) => {res.setHeader('Content-Type','application/json');res.end('{"value":null}');});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const address=server.address(); assert.ok(address&&typeof address!=='string');
  const config={INFRA_GATEWAY_URL:`http://127.0.0.1:${address.port}`,INFRA_GATEWAY_TOKEN:'burst-key'};
  try {
    let loads=0;
    const load=async()=>{loads++; await new Promise(resolve=>setTimeout(resolve,25));return [{id:'shared'}];};
    await runWithInfrastructure(config,async()=>{
      const results=await Promise.all(Array.from({length:50},()=>cachedCatalog('burst',{},load)));
      assert.equal(loads,1,'Concurrent cache misses must not stampede the catalog database');
      assert.ok(results.every(result=>result[0].id==='shared'));
    });
    loads=0;
    await Promise.all([
      runWithInfrastructure(config,()=>cachedCatalog('a',{},load)),
      runWithInfrastructure(config,()=>cachedCatalog('b',{},load)),
      runWithInfrastructure({...config,INFRA_GATEWAY_TOKEN:'other-key'},()=>cachedCatalog('a',{},load)),
    ]);
    assert.equal(loads,3,'Tenant and credential boundaries cannot share pending values');
    await runWithInfrastructure(config,async()=>{
      await assert.rejects(()=>cachedCatalog('retry',{},async()=>{throw new Error('database unavailable');}));
      assert.deepEqual(await cachedCatalog('retry',{},load),[{id:'shared'}]);
    });
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
