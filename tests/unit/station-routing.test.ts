import test from 'node:test';
import assert from 'node:assert/strict';
import { stationForPath, stationAllowsPath } from '../../scripts/station-routing.mjs';

test('station router covers pages, business APIs and generic module operations with boundary checks', () => {
  for (const station of ['mes','erp','pos','crm','dining','shop']) {
    for (const path of [`/${station}`,`/${station}/detail`,`/api/${station}/data`,`/api/operations/${station}`]) {
      assert.equal(stationForPath(path),station);
      assert.equal(stationAllowsPath(station,path),true);
    }
  }
  for (const path of ['/platform','/api/platform/control/status','/api/seed/reset','/api/workspace/backup','/mes-other','/api/operations/mes/evil']) {
    assert.equal(stationForPath(path),null);
  }
  assert.equal(stationAllowsPath('mes','/api/health'),true);
  assert.equal(stationAllowsPath('mes','/erp'),false);
  assert.equal(stationAllowsPath('mes','/api/shop/checkout'),false);
  assert.equal(stationAllowsPath('mes','/api/platform/control/status'),false);
  assert.equal(stationForPath('/m%65s'), 'mes');
  assert.equal(stationForPath('/api/mes%2Fdata'), 'mes');
  assert.equal(stationForPath('/commerce'),'shop');
  assert.equal(stationForPath('/commerce/orders'),'shop');
  assert.equal(stationAllowsPath('shop','/commerce'),true);
  assert.equal(stationAllowsPath('erp','/commerce'),false);
});
