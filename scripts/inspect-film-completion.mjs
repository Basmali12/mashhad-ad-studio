// Read-only local records and file presence. Never invokes a provider or prints prompts/credentials.
import fs from 'node:fs';
import process from 'node:process';
import console from 'node:console';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
if(process.getuid?.()!==0)throw Error('ROOT_REQUIRED');
for(const line of fs.readFileSync('/etc/iraq-ai-film-platform-staging/film.env','utf8').split('\n')){const at=line.indexOf('=');if(at>0&&!line.startsWith('#'))process.env[line.slice(0,at)]=line.slice(at+1).trim();}
const {openStore}=await import(pathToFileURL('/srv/iraq-ai-studio-staging/current/services/film-engine/engine/open-store.mjs'));
const store=await openStore(process.env.FILM_DATA_DIR,process.env.ENGINE_MASTER_KEY);
try{
 const projects=(await store.all('film-project')).sort((a,b)=>(b.launch?.approvedAt||b.updatedAt||0)-(a.launch?.approvedAt||a.updatedAt||0)).slice(0,4);
 const data=[];for(const p of projects){const scenes=[];for(const s of p.scenes||[]){const j=s.jobId?await store.get('job',s.jobId):null;const file=j?path.join(store.folder,'artifacts',j.id,'video.mp4'):null;scenes.push({status:s.status,attempted:!!s.attempted,jobId:j?.id||null,jobStatus:j?.status||null,error:j?.error||null,verified:!!j?.result?.videoVerified,fileExists:!!file&&fs.existsSync(file)});}data.push({id:p.id,seconds:p.seconds,state:p.state,error:p.error,launchState:p.launch?.state,mergeStatus:p.merge?.status||null,finalExists:!!p.merge?.path&&fs.existsSync(p.merge.path),scenes});}
 console.log(JSON.stringify({projects:data,activeRentals:(await store.all('rental')).filter(r=>r.state!=='closed').length}));
}finally{await store.close();}
