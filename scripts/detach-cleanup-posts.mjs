/* global console, process */
import {spawnSync} from 'node:child_process';
function cli(fn,args){const r=spawnSync(process.execPath,['node_modules/convex/bin/main.js','run',fn,JSON.stringify(args)],{encoding:'utf8',timeout:60000});if(r.status!==0)throw Error(r.stderr||'Command failed');return JSON.parse(r.stdout);}
const posts=cli('videoCleanup:pendingPosts',{});
console.log(cli('videoCleanup:detachPendingPosts',{ids:posts.map(p=>p.id)}));
