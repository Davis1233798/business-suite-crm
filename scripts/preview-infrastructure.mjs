import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Wrangler reads .dev.vars beside the generated configuration.
const values = Object.fromEntries(readFileSync('infra/.env', 'utf8').split(/\r?\n/).filter(s => s && !s.startsWith('#')).map(s => { const i = s.indexOf('='); return [s.slice(0,i), s.slice(i+1)]; }));
if (!/^[a-zA-Z0-9_-]{32,}$/.test(values.GATEWAY_TOKEN ?? '')) throw new Error('Set a URL-safe gateway token in infra/.env');
writeFileSync('dist/server/.dev.vars', `INFRA_GATEWAY_URL=http://127.0.0.1:8088\nINFRA_GATEWAY_TOKEN=${values.GATEWAY_TOKEN}\n`, { mode: 0o600 });
const result = spawnSync(process.execPath, ['--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js', 'dev', '--config', 'dist/server/wrangler.json', '--local', '--persist-to', '.wrangler/state', '--ip', '127.0.0.1', '--port', '8787', '--inspector-port', '0', '--test-scheduled'], {stdio:'inherit'});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
