import process from 'node:process';
import console from 'node:console';
// Read-only operational diagnosis. Never print messages, credentials or raw errors.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
if(process.getuid?.()!==0)throw Error('ROOT_REQUIRED');
for(const line of fs.readFileSync('/etc/iraq-ai-film-platform-staging/film.env','utf8').split('\n')){const at=line.indexOf('=');if(at>0&&!line.startsWith('#'))process.env[line.slice(0,at)]=line.slice(at+1).trim();}
const root='/srv/iraq-ai-studio-staging/current/services/film-engine/engine';
const {openStore}=await import(pathToFileURL(root+'/open-store.mjs'));
const store=await openStore(process.env.FILM_DATA_DIR,process.env.ENGINE_MASTER_KEY);
try{
 const now=Date.now(),reservations=(await store.all('film-text-reservation')).filter(r=>r.createdAt>now-30*86400000),projects=await store.all('film-project');
 console.log(JSON.stringify({textEnabled:process.env.FILM_TEXT_ENABLED,budgetMicroUSD:Number(process.env.FILM_TEXT_ADMIN_BUDGET_MICRO_USD),keyConfigured:!!(await store.get('config','openai-director'))?.credentials,reservations:reservations.length,reservedMicroUSD:reservations.reduce((s,r)=>s+r.reservedMicroUSD,0),last24hCalls:reservations.filter(r=>r.createdAt>now-86400000).reduce((s,r)=>s+r.calls,0),recentProjects:projects.sort((a,b)=>(b.updatedAt||b.createdAt||0)-(a.updatedAt||a.createdAt||0)).slice(0,5).map(p=>({id:p.id,textCalls:p.textCalls,pending:!!p.textPending,error:p.error,hasLaunch:!!p.launch})),activeRentals:(await store.all('rental')).filter(r=>r.state!=='closed').map(r=>({id:r.id,state:r.state})),recentTextCalls:(await store.all('text-call')).sort((a,b)=>b.createdAt-a.createdAt).slice(0,5).map(r=>({id:r.id,status:r.status,error:r.error,usageUSD:r.usage?.computedUSD}))}));
}finally{await store.close();}
