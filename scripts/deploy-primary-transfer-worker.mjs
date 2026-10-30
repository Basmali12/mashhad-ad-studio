// Explicit root maintenance: inspect by default. Credentials stay in a private pipe.
import fs from 'node:fs';
import process from 'node:process';
import console from 'node:console';
import {setTimeout,clearTimeout} from 'node:timers';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
if(process.getuid?.()!==0)throw Error('ROOT_MAINTENANCE_REQUIRED');
for(const line of fs.readFileSync('/etc/iraq-ai-film-platform-staging/film.env','utf8').split('\n')){
 if(!line||line.startsWith('#'))continue;const index=line.indexOf('=');if(index>0)process.env[line.slice(0,index)]=line.slice(index+1).trim();
}
const root='/srv/iraq-ai-studio-staging/current/services/film-engine/engine';
const {openStore}=await import(pathToFileURL(root+'/open-store.mjs'));
const {ModalProvider,providerEnvironment}=await import(pathToFileURL(root+'/provider.mjs'));
const store=await openStore(process.env.FILM_DATA_DIR,process.env.ENGINE_MASTER_KEY);
try{
 const active=await store.query("select count(*)::int as count from iff_records where (kind='job' and coalesce(data->>'cloudStopped','false')!='true') or (kind='rental' and data->>'state'!='closed')");
 if(active.rows[0].count!==0)throw Error('ACTIVE_WORK_NO_WORKER_DEPLOYMENT');
 const source=(await store.all('account')).find(a=>a.workspace==='basm1998ali'&&!a.unlinked);
 if(!source)throw Error('TRUSTED_PRIMARY_NOT_LINKED');
 const credentials=source.mode==='local_profile'?{mode:'local_profile'}:store.open(source.credentials,source.id);
 const provider=new ModalProvider(),input={source:credentials,workerApp:'iff-ltx25-cloud-copy-v1'};
 let checked=await provider.call('cloud_transfer_preflight',input);
 console.log(JSON.stringify({stage:'inspect',...checked}));
 if(!checked.workerReady&&process.argv.includes('--approve-worker-deploy')){
  const outcome=await new Promise(resolve=>{
   const child=spawn(provider.python,[root+'/deploy_transfer_worker.py','--approve-worker-deploy','--credentials-stdin'],{cwd:root,env:providerEnvironment({credentials}),stdio:['pipe','pipe','pipe']});
   let settled=false;const finish=code=>{if(settled)return;settled=true;clearTimeout(timer);resolve(code);};
   const timer=setTimeout(()=>{child.kill();finish(-2);},600000);
   child.stdout.on('data',()=>{});child.stderr.on('data',()=>{});
   child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(credentials)+'\n');child.once('error',()=>finish(-1));child.once('close',finish);
  });
  if(outcome!==0)throw Error('WORKER_DEPLOYMENT_NOT_CONFIRMED_NO_RETRY');
  checked=await provider.call('cloud_transfer_preflight',input);
  console.log(JSON.stringify({stage:'after_explicit_deploy',...checked,gpuCalls:0,transfers:0}));
  if(!checked.workerReady)throw Error('WORKER_DEPLOYMENT_NOT_READY_NO_RETRY');
 }
}catch(error){console.error(/^[A-Z_]{5,100}$/.test(error.message)?error.message:'WORKER_MAINTENANCE_FAILED');process.exitCode=1;}finally{await store.close();}
