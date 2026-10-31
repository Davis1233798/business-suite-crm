import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../infra/', import.meta.url));
const registry = JSON.parse(readFileSync(new URL('../infra/sites.json', import.meta.url), 'utf8'));
const linux = process.argv.includes('--linux');
const [action = 'plan', site] = process.argv.slice(2).filter(arg => arg !== '--linux');
const allowed = new Set(['plan', 'up', 'status', 'logs', 'stop']);
if (!allowed.has(action)) throw new Error('Expected plan, up, status, logs, or stop');
const selected = site ? registry.sites.find(s => s.id === site) : null;
if (site && !selected) throw new Error('Unknown station');
const services = selected ? (linux && action === 'stop' ? [`web-${selected.id}`] :
  [...new Set(selected.services.filter(service => linux || !service.startsWith('web-')))]) : [];
if (selected && !services.length) {
  console.log(`${selected.name}: uses the shared Web application; no auxiliary container services.`);
  process.exit(0);
}
if (action === 'plan') {
  console.log(JSON.stringify({ ...registry, selected: site ?? 'all', services, apply: `node scripts/infra.mjs up${site ? ' ' + site : ''}${linux ? ' --linux' : ''}` }, null, 2));
  process.exit(0);
}
const args = ['compose', '--project-directory', root, '--file', `${root}compose.yaml`];
if (linux) args.push('--file', `${root}linux/compose.web.yaml`);
const commands = { up: ['up', '-d', '--build'], status: ['ps'], logs: ['logs', '--tail', '100'], stop: ['stop'] };
const result = spawnSync('docker', [...args, ...commands[action], ...services], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
