/** One owner-approved private FLUX trial. No HTTP/server/site/rental publication.
 * Paid commands require a live independent watchdog and verified provider cap.
 * State/DPAPI credentials live OUTSIDE this repository; secrets never print.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {setTimeout as wait} from 'node:timers/promises';
import {Store,id} from '../services/film-engine/engine/store.mjs';
import {masterKey} from '../services/film-engine/engine/keyring.mjs';
import {createFluxServices} from '../services/film-engine/engine/flux-integration.mjs';
import {createFluxModalTransport,createFluxPythonRunner} from '../services/film-engine/engine/flux-modal-transport.mjs';
import {createEngineRegistry} from '../services/film-engine/engine/engine-registry.mjs';
import {createAdminModelTestRunner} from '../services/film-engine/engine/admin-model-test-runner.mjs';
import {assertFluxTrialBudget} from '../services/film-engine/engine/flux-trial-policy.mjs';
import {createEngineCommissioning} from '../services/film-engine/engine/engine-commissioning.mjs';
import {waitForCommissioningTest} from './private-commissioning-observation.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// Attempt 2 has a fresh immutable ledger; never erase attempt 1's paid intents.
const attempt=process.argv.includes('--approved-attempt-2')?2:1;
const validationRound=process.argv.includes('--gpu-validation-round-1');
const folder=path.resolve(repo,validationRound?'../../work/flux-primary-gpu-round1':'../../work/flux-primary-trial-20261031'+(attempt===2?'-attempt2':''));
const command=process.argv[2]??'status';
if(!['init','prepare','configure-validation','test','status','stop'].includes(command))throw Error('PRIVATE_TRIAL_COMMAND_INVALID');
const statePath=path.join(folder,'watchdog-state.json'),manifestPath=path.join(folder,'trial.json');
const actor={id:'owner-private-flux-test',isAdmin:true},workspace='basm1998ali';
const print=value=>process.stdout.write(JSON.stringify(value)+'\n');
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
async function write(file,value){const temporary=file+'.pending';await fs.writeFile(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600});await fs.rename(temporary,file);}
async function control(mainStatus,extra={}){await write(statePath+'.control.json',{mainStatus,...extra});}
async function guard(action,packet){
 const s=await read(statePath),m=await read(manifestPath);
 const stop=await fs.readFile(statePath+'.control.json','utf8').then(JSON.parse).catch(()=>({}));
 assertFluxTrialBudget(s,m,{...packet,trialAction:action},Date.now(),stop);
 if(!['prepare','start','generate'].includes(action))throw Error('PRIVATE_TRIAL_ACTION_INVALID');
}

let store,commissioning;
try{
 const exists=await fs.stat(path.join(folder,'engines.sqlite')).then(()=>true).catch(()=>false);
 if(command==='init'&&exists)throw Error('PRIVATE_TRIAL_ALREADY_INITIALIZED');
 if(command!=='init'&&!exists)throw Error('PRIVATE_TRIAL_NOT_INITIALIZED');
 const key=masterKey(folder,{create:command==='init'});if(!key)throw Error('PRIVATE_TRIAL_KEY_UNAVAILABLE');store=new Store(folder,key);
 const underlying=createFluxPythonRunner({timeoutMs:1200000});
 const wrapped=async(action,packet,onEvent)=>{if(['prepare','start','generate'].includes(action))await guard(action,packet);return underlying(action,packet,onEvent);};
 const transport=createFluxModalTransport({store,runner:wrapped,allowPaid:true});
 const flux=createFluxServices({store,transport,allowPaid:true});
 const registry=createEngineRegistry({store,adapter:flux.registryAdapter,allowPaid:true});
 const runner=createAdminModelTestRunner({store,registry,adapters:{'flux2-klein-4b':flux.productionAdapter},allowPaid:true});
 commissioning=createEngineCommissioning({store,registry,testRunner:runner,allowPaid:true});
 let m;
 if(command==='init'){
  const credentials=JSON.parse(execFileSync('python',['-c',"import pathlib,tomllib,json;d=tomllib.loads((pathlib.Path.home()/'.modal.toml').read_text())['basm1998ali'];print(json.dumps({'tokenId':d['token_id'],'tokenSecret':d['token_secret']}))"],{encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']}));
  if(validationRound){
   const previous=path.resolve(repo,'../../work/flux-primary-trial-20261031-attempt2');
   if(!await fs.stat(path.join(previous,'engines.sqlite')).then(()=>true).catch(()=>false))throw Error('PRIVATE_TRIAL_SOURCE_UNAVAILABLE');
   const source=new Store(previous,masterKey(previous,{create:false}));
   try{const saved=(await source.all('engine-definition')).find(e=>e.modelId==='flux2-klein-4b');if(!saved)throw Error('PRIVATE_TRIAL_SOURCE_UNAVAILABLE');
    const accountId=saved.accountId;store.put('account',{id:accountId,name:'Primary private FLUX validation',mode:'token',workspace,credentials:store.seal(credentials,accountId)});store.put('engine-definition',saved);
    m={accountId,engineId:saved.id,workspace,appName:'mashhad-flux-'+saved.id.replaceAll('-','').slice(0,12),createdAt:Date.now()};await write(manifestPath,m);print({initialized:true,round:'gpu-validation-1',reusesVerifiedWeights:true,paidOperations:0});
   }finally{source.close();}
  }else{
  const accountId=id();store.put('account',{id:accountId,name:'Primary private FLUX trial',mode:'token',workspace,credentials:store.seal(credentials,accountId)});
  const entry=await registry.dispatch(actor,'admin.engine.save',{accountId,name:'Private FLUX trial',modelId:'flux2-klein-4b',version:'4B',gpu:'L40S',cpu:4,ramGiB:64,minVramGiB:24,hourPriceUSD:'3',volume:'mashhad-flux-private-'+accountId.slice(0,8)});
  // Trusted private lifecycle, not an HTTP-configurable override or rental change.
  store.put('engine-definition',{...store.get('engine-definition',entry.id),timeout:300,startupTimeout:180,idleSeconds:2});
  m={accountId,engineId:entry.id,workspace,appName:'mashhad-flux-'+entry.id.replaceAll('-','').slice(0,12),createdAt:Date.now()};await write(manifestPath,m);print({command,initialized:true,engineId:m.engineId,appName:m.appName,paidOperations:0});
  }
 }else{
  m=await read(manifestPath);
  if(command==='configure-validation'){
   if(!validationRound||store.get('private-trial-paid-intent','test')||store.all('engine-runtime').some(r=>!r.cloudStopped)||store.get('engine-preparation',m.engineId)?.cloudStopped!==true)throw Error('PRIVATE_TRIAL_CONFIG_BUSY');
   const d=store.get('engine-definition',m.engineId);if(d.idleSeconds!==60){store.put('engine-definition',{...d,idleSeconds:60,revision:d.revision+1});store.delete('engine-inspection',m.engineId);}
   const inspected=await registry.dispatch(actor,'admin.engine.inspect',{id:m.engineId});print({phase:'configuration',idleSeconds:60,ready:inspected.preparationState==='ready',blockers:inspected.blockers});
  }else if(command==='prepare'){
   if(store.get('private-trial-paid-intent','prepare'))throw Error('PRIVATE_TRIAL_NO_REPEAT');
   const q=await registry.dispatch(actor,'admin.engine.quote',{id:m.engineId,action:'prepare'});if(!q.dispatchAvailable)throw Error('PRIVATE_TRIAL_PREPARATION_NOT_READY');
   store.put('private-trial-paid-intent',{id:'prepare',requestId:'private-flux-prepare-once',createdAt:Date.now(),quoteId:q.id,state:'claimed'});
   print({phase:'prepare',approved:true,missingBytes:q.missingBytes,estimate:q.estimate});
   let result=await registry.dispatch(actor,'admin.engine.prepare',{id:m.engineId,quoteId:q.id,requestId:'private-flux-prepare-once',approved:true});
   while(result.preparation?.cloudStopped!==true){print({phase:'prepare',status:result.preparation?.status,progress:result.preparation?.progress});if(['failed','uncertain','cancelled'].includes(result.preparation?.status))throw Error('PRIVATE_TRIAL_PREPARATION_FAILED');const state=await read(statePath);if(state.status!=='watching'||Date.now()>=state.deadline)throw Error('PRIVATE_TRIAL_WATCHDOG_STOP');await wait(5000);result=await registry.dispatch(actor,'admin.engine.status',{id:m.engineId});}
   store.put('private-trial-paid-intent',{...store.get('private-trial-paid-intent','prepare'),state:result.preparation?.status,finishedAt:Date.now()});if(result.preparation?.status!=='completed')throw Error('PRIVATE_TRIAL_PREPARATION_FAILED');
   const inspected=await registry.dispatch(actor,'admin.engine.inspect',{id:m.engineId});print({phase:'prepare',completed:inspected.preparationState==='ready',deployment:inspected.deploymentState});
  }else if(command==='test'){
   if(store.get('private-trial-paid-intent','test'))throw Error('PRIVATE_TRIAL_NO_REPEAT');
   const input=await runner.createProject({definition:store.get('engine-definition',m.engineId),adminId:actor.id,input:{orientation:'portrait',prompt:'A photorealistic portrait of an adult Iraqi man, age about 35, natural dark hair and a neatly trimmed short beard, wearing a simple plain shirt, standing in a contemporary Baghdad courtyard. Natural warm daylight, realistic skin texture, calm expression, medium close-up, cinematic lens. Clean unmarked walls, ordinary present-day surroundings.'}});
   const q=await commissioning.dispatch(actor,'admin.engine.test.quote',{id:m.engineId,input:{projectId:input.projectId,stageId:input.stageId}});if(!q.dispatchAvailable)throw Error('PRIVATE_TRIAL_TEST_NOT_READY');
   store.put('private-trial-paid-intent',{id:'test',requestId:'private-flux-image-once',quoteId:q.id,createdAt:Date.now(),state:'claimed'});
   let result=await commissioning.dispatch(actor,'admin.engine.test.execute',{id:m.engineId,quoteId:q.id,requestId:'private-flux-image-once',approved:true});
   const test=await waitForCommissioningTest(result,{observe:()=>commissioning.status({id:m.engineId,requestId:'private-flux-image-once'},actor),continueAllowed:async()=>{const state=await read(statePath);if(state.status!=='watching'||Date.now()>=state.deadline)throw Error('PRIVATE_TRIAL_WATCHDOG_STOP');},onProgress:test=>print({phase:'image',state:test.status,progress:test.progress}),wait:()=>wait(2000)});
   if(test.status!=='needs_review'||test.cloudStopped!==true||test.artifacts?.length!==1)throw Error('PRIVATE_TRIAL_TEST_FAILED');
   const a=store.get('production-asset',test.artifacts[0].id);print({phase:'image',completed:true,cloudStopped:true,testId:test.id,artifact:{id:a.id,path:a.path,sha256:a.sha256,width:a.width,height:a.height,bytes:a.bytes}});
   store.put('private-trial-paid-intent',{...store.get('private-trial-paid-intent','test'),state:'completed',finishedAt:Date.now(),assetId:a.id});await control('completed',{stopRequested:true});
  }else if(command==='stop'){await control('failed',{stopRequested:true});print({stopRequested:true,scope:m.appName});}
  else {print({engine:await registry.dispatch(actor,'admin.engine.status',{id:m.engineId}),commissioning:await commissioning.status({id:m.engineId},actor)});}
 }
}catch(error){
 if(command!=='init'&&!['status','stop'].includes(command))await control('failed',{stopRequested:true}).catch(()=>{});
 print({ok:false,error:/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'PRIVATE_TRIAL_FAILED'});process.exitCode=1;
}finally{await commissioning?.close();await commissioning?.drain();store?.close();}
