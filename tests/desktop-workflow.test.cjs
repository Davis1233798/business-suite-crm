const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const workflow = fs.readFileSync('.github/workflows/crm.yml', 'utf8');
const windowsDesktop = workflow.split('\n  windows-desktop:\n')[1]?.split('\n  crm:\n')[0] ?? '';
const crm = workflow.split('\n  crm:\n')[1]?.split('\n  publish:\n')[0] ?? '';
const publish = workflow.split('\n  publish:\n')[1] ?? '';

test('Windows desktop CI checks identity before packaging its artifact', () => {
  assert.match(windowsDesktop, /needs: crm/);
  const steps = [
    'node --test tests/desktop-identity.test.cjs',
    'npm run desktop:prepare',
    'npm run desktop:package',
    'actions/upload-artifact@v4',
  ];
  const positions = steps.map((step) => windowsDesktop.indexOf(step));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
});

test('release image build has web assets and waits for both validations', () => {
  assert.match(crm, /node --test tests\/desktop-workflow\.test\.cjs/);
  assert.match(publish, /needs: \[crm, windows-desktop\]/);
  assert.match(publish, /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
  const steps = ['npm run install:ci', 'npm run web:build', 'docker build -f infra/linux/Dockerfile.station'];
  const positions = steps.map((step) => publish.indexOf(step));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.match(fs.readFileSync('infra/linux/Dockerfile.station', 'utf8'), /COPY web-dist\//);
});
