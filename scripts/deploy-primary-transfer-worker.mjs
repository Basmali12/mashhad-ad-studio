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
const profile=JSON.parse(fs.readFileSync(root+'/model-profile.json','utf8'));
if(profile.enabled!==true||!Object.keys(profile.files||{}).length)throw Error('ENGINE_NOT_CONFIGURED');
const workerApp=process.env.ENGINE_CLOUD_TRANSFER_APP;
if(!workerApp||! /^[A-Za-z0-9_-]{1,100}$/.test(workerApp))throw Error('TRANSFER_WORKER_APP_REQUIRED');
const {openStore}=await import(pathToFileURL(root+'/open-store.mjs'));
const {ModalProvider,providerEnvironment}=await import(pathToFileURL(root+'/provider.mjs'));
const store=await openStore(process.env.FILM_DATA_DIR,process.env.ENGINE_MASTER_KEY);
try{
 const active=await store.query("select count(*)::int as count from iff_records where (kind='job' and coalesce(data->>'cloudStopped','false')!='true') or (kind='rental' and data->>'state'!='closed')");
 if(active.rows[0].count!==0)throw Error('ACTIVE_WORK_NO_WORKER_DEPLOYMENT');
 const source=(await store.all('account')).find(a=>a.workspace==='basm1998ali'&&!a.unlinked);
 if(!source)throw Error('TRUSTED_PRIMARY_NOT_LINKED');
 const credentials=source.mode==='local_profile'?{mode:'local_profile'}:store.open(source.credentials,source.id);
 const provider=new ModalProvider(),input={source:credentials,workerApp};
 let checked=await provider.call('cloud_transfer_preflight',input);
 console.log(JSON.stringify({stage:'inspect',...checked}));
 if(process.argv.includes('--diagnose-only')){
  const code=`import os,sys,json
from modal_bridge import client
from transfer_contract import *
import modal
try:
 c,w=client(json.loads(sys.stdin.readline()))
 state=modal.Dict.from_name(DICT_NAME,client=c,create_if_missing=False,environment_name='main')
 active=state.get('active');deployment=state.get('deployment',{})
 print(json.dumps({'activeTransfer':active,'deployedFingerprint':deployment.get('fingerprint'),'expectedFingerprint':FINGERPRINT}))
 os.environ['IFF_DEFINE_TRANSFER_WORKER']='YES'
 import transfer_worker
 print(json.dumps({'localDefinitionReady':True}))
except BaseException as e:
 print(json.dumps({'diagnosticErrorClass':type(e).__name__}))
`;
  const child=spawn(provider.python,['-c',code],{cwd:root,env:providerEnvironment({credentials}),stdio:['pipe','pipe','pipe']});
  let output='';child.stdout.on('data',b=>{output+=b;if(output.length>20000)child.kill();});child.stderr.on('data',()=>{});
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(credentials)+'\n');await new Promise(resolve=>{child.once('close',resolve);child.once('error',resolve);});
  for(const line of output.split('\n'))try{const d=JSON.parse(line);console.log(JSON.stringify({stage:'safe_diagnostic',activeTransfer:d.activeTransfer??null,deployedFingerprint:d.deployedFingerprint??null,expectedFingerprint:d.expectedFingerprint??null,localDefinitionReady:d.localDefinitionReady??null,diagnosticErrorClass:d.diagnosticErrorClass??null}));}catch{/* Raw SDK output is never forwarded. */}
 }
 if(!checked.workerReady&&process.argv.includes('--approve-worker-deploy')){
  const outcome=await new Promise(resolve=>{
   const child=spawn(provider.python,[root+'/deploy_transfer_worker.py','--approve-worker-deploy','--credentials-stdin'],{cwd:root,env:providerEnvironment({credentials}),stdio:['pipe','pipe','pipe']});
   let settled=false;const finish=code=>{if(settled)return;settled=true;clearTimeout(timer);resolve(code);};
   const timer=setTimeout(()=>{child.kill();finish(-2);},600000);
   let output='';child.stdout.on('data',b=>{output+=b;let newline;while((newline=output.indexOf('\n'))>=0){const line=output.slice(0,newline);output=output.slice(newline+1);try{const d=JSON.parse(line);if(d.type==='worker_deploy_diagnostic'&&['arguments','identity','registry','definition','deployment','record'].includes(d.stage)&&/^[A-Za-z_]{1,80}$/.test(d.errorClass))console.log(JSON.stringify({stage:d.stage,errorClass:d.errorClass}));}catch{/* Ignore raw SDK text. */}}if(output.length>20000)output='';});child.stderr.on('data',()=>{});
   child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(credentials)+'\n');child.once('error',()=>finish(-1));child.once('close',finish);
  });
  if(outcome!==0)throw Error('WORKER_DEPLOYMENT_NOT_CONFIRMED_NO_RETRY');
  checked=await provider.call('cloud_transfer_preflight',input);
  console.log(JSON.stringify({stage:'after_explicit_deploy',...checked,gpuCalls:0,transfers:0}));
  if(!checked.workerReady)throw Error('WORKER_DEPLOYMENT_NOT_READY_NO_RETRY');
 }
}catch(error){console.error(/^[A-Z_]{5,100}$/.test(error.message)?error.message:'WORKER_MAINTENANCE_FAILED');process.exitCode=1;}finally{await store.close();}
