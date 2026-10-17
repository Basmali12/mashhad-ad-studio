/* global console, process */
import {spawnSync} from 'node:child_process';
function cli(args){const r=spawnSync(process.execPath,['node_modules/convex/bin/main.js',...args],{encoding:'utf8',timeout:60000});if(r.status!==0)throw Error(r.stderr||'Command failed');return r.stdout.trim();}
const identity=JSON.stringify({subject:cli(['env','get','OWNER_SUBJECT']),issuer:cli(['env','get','CLERK_JWT_ISSUER_DOMAIN']),email:'basm1998ali@gmail.com'});
const posts=JSON.parse(cli(['run','videoCleanup:pendingPosts','{}']));
for(const p of posts)console.log(cli(['run','buffer:cancelForCleanup',JSON.stringify({id:p.id}),'--identity',identity]));
