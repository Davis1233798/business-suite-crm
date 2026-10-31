import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
function run(cmd,args,options={}){const r=spawnSync(cmd,args,{stdio:'inherit',shell:process.platform==='win32'&&cmd.endsWith('.cmd'),...options});if(r.status!==0)process.exit(r.status||1)}
run(process.platform==='win32'?'npm.cmd':'npm',['run','web:build']);
mkdirSync('outputs/go',{recursive:true});
run('go',['build','-trimpath','-o',path.resolve('outputs/go',process.platform==='win32'?'business-suite.exe':'business-suite'),'.'],{cwd:path.resolve('backend'),env:{...process.env,CGO_ENABLED:'0'}});
