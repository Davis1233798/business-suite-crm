import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {proxyPlatformControl} from '../../lib/platform-control';

test('platform proxy requires operator auth, allowlists operations and never forwards demo identity', async () => {
  let received = 0;
  const server = createServer((req,res) => {
    received++;
    assert.equal(req.headers.authorization,'Bearer operator');
    assert.equal(req.headers.cookie,undefined);
    assert.equal(req.headers['x-user-role'],undefined);
    res.setHeader('Content-Type','application/json'); res.end('{"services":[]}');
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const backend = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await proxyPlatformControl(new Request('https://suite/api/platform/control/status',{headers:{cookie:'demo_user_role=admin'}}),backend)).status,401);
    assert.equal((await proxyPlatformControl(new Request('https://suite/api/platform/control/exec',{method:'POST'}),backend)).status,404);
    assert.equal((await proxyPlatformControl(new Request('https://suite/api/platform/control/apply'),backend)).status,405);
    assert.equal(received,0);
    const response = await proxyPlatformControl(new Request('https://suite/api/platform/control/status',{headers:{authorization:'Bearer operator',cookie:'demo_user_role=admin','x-user-role':'admin'}}),backend);
    assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal(received,1);
  } finally { await new Promise<void>(resolve=>server.close(()=>resolve())); }
});
