/* global console, process */
import { randomBytes,createHash,randomUUID } from 'node:crypto';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const env=await readFile('.env.local','utf8');if(!env.includes('CONVEX_DEPLOYMENT=dev:capable-cuttlefish-575'))throw new Error('Development deployment mismatch');
const root=resolve('../../work/mashhad-worker');await mkdir(root,{recursive:true});
let config;try{config=JSON.parse(await readFile(resolve(root,'connection.secret'),'utf8'));}catch{config={site:'https://capable-cuttlefish-575.convex.site',token:randomBytes(32).toString('hex'),workerId:randomUUID()};await writeFile(resolve(root,'connection.secret'),JSON.stringify(config),{mode:0o600});}
const hash=createHash('sha256').update(config.token).digest('hex');
execFileSync(process.execPath,['node_modules/convex/bin/main.js','env','set','WORKER_KEY_SHA256',hash],{stdio:'pipe'});
console.log('Worker capability configured on Development. Secret retained only in work/mashhad-worker/connection.secret.');
