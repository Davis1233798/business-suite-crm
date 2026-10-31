import test from 'node:test';
import assert from 'node:assert/strict';
import {NextRequest} from 'next/server';
import {middleware} from '../../middleware';
import {GET} from '../../app/api/health/route';
import {runWithDatabase} from '../../db';
import {createSqliteD1} from '../../lib/db/sqlite-d1';

test('anonymous readiness probes check the database without creating demo tenants or cookies',async()=>{
  const db=createSqliteD1();
  try {
    await runWithDatabase(db,async()=>{
      for(let i=0;i<5;i++){
        const middlewareResponse=await middleware(new NextRequest('http://localhost/api/health'));
        assert.equal(middlewareResponse.headers.get('set-cookie'),null);
        assert.equal((await GET()).status,200);
      }
      const count=await db.prepare('SELECT count(*) AS n FROM organizations').first('n');
      assert.equal(count,0,'Recurring healthchecks must not seed business records or MES events');
    });
  } finally {db._rawDb.close();}
});
