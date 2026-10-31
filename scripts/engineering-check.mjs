import { spawnSync } from 'node:child_process';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const commands = [
  ['python', ['-m', 'unittest', 'discover', '-s', 'tests', '-v'], 'infra'],
  [process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'], '.'],
  [npm, ['test'], '.'],
  [npm, ['run', 'build'], '.'],
];
for (const [command, args, cwd] of commands) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' && command.endsWith('.cmd') });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
