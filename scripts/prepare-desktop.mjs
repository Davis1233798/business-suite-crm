import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
function run(cmd,args,options={}){const r=spawnSync(cmd,args,{stdio:'inherit',shell:process.platform==='win32'&&cmd.endsWith('.cmd'),...options});if(r.status!==0)process.exit(r.status||1)}
run(process.platform==='win32'?'npm.cmd':'npm',['run','web:build']);
mkdirSync('outputs/go',{recursive:true});
const windows = process.platform === 'win32';
if (windows && (!process.env.CGO_CFLAGS || !process.env.CGO_LDFLAGS)) {
  throw new Error('Windows CRM desktop requires the pinned SQLCipher compiler and linker flags');
}
const tags = windows ? ['-tags', 'libsqlite3'] : [];
run('go', ['build', ...tags, '-trimpath', '-o',
  path.resolve('outputs/go', windows ? 'business-suite.exe' : 'business-suite'), '.'],
  {cwd: path.resolve('backend'), env: {...process.env, CGO_ENABLED: windows ? '1' : '0'}});
