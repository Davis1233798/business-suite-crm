const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const packageJson = require('../desktop/package.json');
const { desktopPaths } = require('../desktop/paths.cjs');

test('CRM desktop package has an application identity of its own', () => {
  assert.equal(packageJson.build.appId, 'org.blockchen.relationdesk.crm');
  assert.equal(packageJson.build.productName, 'RelationDesk CRM');
  const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  assert.match(main, /app\.setPath\('userData',\s*dataPaths\.userData\)/);
  assert.match(main, /SUITE_DB:\s*dataPaths\.database/);
});

test('CRM desktop profile and database stay in the CRM app-data namespace', () => {
  const appData = path.resolve('fixture-app-data');
  const paths = desktopPaths(appData);

  assert.equal(paths.userData, path.join(appData, 'RelationDesk CRM'));
  assert.equal(paths.database, path.join(appData, 'RelationDesk CRM', 'crm-repository.sqlite'));
  assert.equal(path.dirname(paths.database), paths.userData);
  assert.notEqual(paths.database, path.join(appData, 'Business Suite', 'suite.sqlite'));
  assert.notEqual(paths.database, path.join(appData, 'ForgeFlow MES', 'mes-repository.sqlite'));
});

test('CRM desktop paths reject a relative Windows app-data root', () => {
  assert.throws(() => desktopPaths('relative-app-data'), /must be absolute/);
});
