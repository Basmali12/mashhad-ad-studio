/* global console, process */
import {spawnSync} from 'node:child_process';
import {writeFileSync,readFileSync,mkdirSync} from 'node:fs';
const dir='../../outputs',manifest=dir+'/video-cleanup-20261010.json';
function run(fn,args){const r=spawnSync(process.execPath,['node_modules/convex/bin/main.js','run',fn,JSON.stringify(args)],{encoding:'utf8',timeout:60000});if(r.status!==0)throw Error(r.stderr||'Convex command failed');return JSON.parse(r.stdout);}
if(process.argv.includes('--delete')){const m=JSON.parse(readFileSync(manifest,'utf8'));let removed=0,bytes=0;for(let n=0;n<m.files.length;n+=25){const r=run('videoCleanup:remove',{ids:m.files.slice(n,n+25).map(f=>f.id),allMedia:true});removed+=r.removed;bytes+=r.bytes;console.log(JSON.stringify({removed,bytes}));}writeFileSync(dir+'/video-cleanup-result-20261010.json',JSON.stringify({removed,bytes,at:new Date().toISOString()}));}
else{let cursor=null,done=false,files=[],scanned=0,busy;while(!done){const r=run('videoCleanup:inventory',{cursor,allMedia:true});files.push(...r.files);scanned+=r.scanned;busy=r.busy;cursor=r.cursor;done=r.done;}mkdirSync(dir,{recursive:true});writeFileSync(manifest,JSON.stringify({files,scanned,busy,at:new Date().toISOString()},null,2));console.log(JSON.stringify({media:files.length,bytes:files.reduce((s,f)=>s+f.size,0),scanned,busy}));}
