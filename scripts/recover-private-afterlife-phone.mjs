/** CPU-only import of the already completed, independently fetched native image.
 * No provider runtime, token access, inference, grant reactivation or publication. */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {Store,hash} from '../services/film-engine/engine/store.mjs';
import {masterKey} from '../services/film-engine/engine/keyring.mjs';
import {createFluxImageAssets} from '../services/film-engine/engine/flux-image-assets.mjs';
import {createImageQuality} from '../services/film-engine/engine/image-quality.mjs';
import {privateAfterlifeFilmScope} from '../services/film-engine/engine/admin-inference-authorization.mjs';
import {ACTOR,OWNER,FILM_ID,ENGINE_IDS} from './private-afterlife-film-runner.mjs';

const TEST='88b34afd-6d39-4dcf-bbfe-8826126bfd13',RUN='af25b21b-8557-4726-bd95-8e35b0e8de76',SHA='79003dfefb2d879e9cbce0f2722c4242a02abfdbc45f3f05ea241baff9ce8c97',STAGE='scene_image:phone';
export function assertRecoveredPhone({record,request,stage,attempt,history,definition,receipt,bytes,stopped}){
 const m=receipt?.metadata,s=receipt?.scope;
 if(record?.id!==TEST||record.runId!==RUN||record.stageId!==STAGE||record.adminId!==ACTOR.id||record.cloudStopped!==true||record.result||request?.id!==TEST||request.runId!==RUN||request.stageId!==STAGE||request.definitionId!==ENGINE_IDS['qwen-image-edit-2511']||request.definitionId!==definition?.id||request.accountId!==definition.accountId||request.modelId!=='qwen-image-edit-2511'||request.modelRevision!==receipt?.modelRevision||request.referenceIds?.length!==2||!['uncertain','awaiting_local_commit'].includes(request.state)||stage?.attemptId!==TEST||stage.state!=='failed'||stage.result||attempt?.status!=='failed'||attempt.cancelRequested||attempt.administrative!==true||history?.runId!==RUN||history.cloudStopped!==true||history.engineId!==definition.id||stopped?.appId!=='ap-wpx166qQ4HR8TI4ZVPM8Yo'||stopped.cloudStopped!==true||receipt?.status!=='completed'||receipt.requestId!==TEST||receipt.runId!==RUN||s?.engineId!==definition.id||s.accountId!==definition.accountId||s.runId!==RUN||s.requestId!==TEST||m?.modelId!=='qwen-image-edit-2511'||m.revision!==request.modelRevision||m.version!==request.modelVersion||m.width!==720||m.height!==1280||m.seed!==request.settings.seed||m.steps!==40||m.referenceCount!==2||receipt.progress?.completed!==40||m.sha256!==SHA||hash(bytes)!==SHA||bytes.length!==m.bytes)throw Error('PRIVATE_FILM_PHONE_RECOVERY_UNVERIFIED');
}
async function main(){
 const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),base=path.resolve(repo,'../../work/flux-primary-gpu-round1'),work=path.resolve(repo,'../../work/afterlife-film-20261101'),store=new Store(base,masterKey(base));let claim;
 try{
  const p=store.get('production-project',store.get('private-film-project',FILM_ID)?.projectId),d=store.get('engine-definition',ENGINE_IDS['qwen-image-edit-2511']);
  if(!privateAfterlifeFilmScope({project:p,definition:d,account:store.get('account',d.accountId),adminId:ACTOR.id})||p.customerId!==OWNER)throw Error('PRIVATE_FILM_SCOPE_INVALID');
  const record=store.get('admin-native-test',TEST),request=store.get('qwen-image-request',TEST),stage=store.get('production-stage',hash(p.id+':'+STAGE)),attempt=store.get('production-attempt',TEST),history=store.get('engine-runtime-history',RUN),receipt=JSON.parse(await fs.readFile(path.join(work,'native-phone-receipt.json'),'utf8')),bytes=await fs.readFile(path.join(work,'native-phone.png')),stopped=JSON.parse(await fs.readFile(path.join(work,'qwen-image-edit-2511-phone1-watchdog.json'),'utf8'));
  assertRecoveredPhone({record,request,stage,attempt,history,definition:d,receipt,bytes,stopped});
  if(store.all('engine-runtime').some(r=>!r.cloudStopped)||store.all('production-stage').some(s=>s.projectId===p.id&&s.state==='running'))throw Error('PRIVATE_FILM_BUSY');
  claim={stage,attempt};await store.transaction(async()=>{store.put('production-stage',{...stage,state:'running',localRecovery:true});store.put('production-attempt',{...attempt,status:'running',localRecovery:true});});
  const images=createFluxImageAssets({store,modelProfile:{modelId:request.modelId,version:request.modelVersion,revision:request.modelRevision}}),saved=await images.commit({customerId:OWNER,projectId:p.id,attemptId:TEST,stageId:STAGE,shotId:'phone',bytes,request:{modelId:request.modelId,modelVersion:request.modelVersion,revision:request.modelRevision,prompt:request.prompt,settings:request.settings,referenceIds:request.referenceIds},expectedWidth:720,expectedHeight:1280});
  await createImageQuality({store,assets:images}).assess({customerId:OWNER,projectId:p.id,assetId:saved.assetId,expectedWidth:720,expectedHeight:1280,requirements:{allowText:false,referenceBindings:request.structured.referenceBindings}});
  const result={assetIds:[saved.assetId]};await store.transaction(async()=>{store.put('qwen-image-request',{...request,state:'completed',assetId:saved.assetId,finishedAt:Date.now(),privateReadOnlyRecovery:true});store.put('production-attempt',{...attempt,status:'completed',localRecovery:false});store.put('production-stage',{...stage,state:'completed',result,localRecovery:false});store.put('private-film-output-recovery',{id:TEST,filmId:FILM_ID,projectId:p.id,stageId:STAGE,runId:RUN,assetId:saved.assetId,sha256:SHA,nativeReceipt:receipt,gpuStarted:false,revokedGrantRetained:true,at:Date.now()});store.audit('private_film_existing_output_imported',p.id,{testId:TEST,sha256:SHA});});
  claim=null;await fs.writeFile(path.join(work,'scene_image-phone-result.json'),JSON.stringify({stageId:STAGE,testId:TEST,cloudStopped:true,recovered:true,gpuStarted:false,artifacts:[store.get('production-asset',saved.assetId)]},null,2));process.stdout.write(JSON.stringify({recovered:true,gpuStarted:false,assetId:saved.assetId,path:store.get('production-asset',saved.assetId).path})+'\n');
 }finally{if(claim)await store.transaction(async()=>{store.put('production-stage',claim.stage);store.put('production-attempt',claim.attempt);});store.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{process.stderr.write('PRIVATE_FILM_PHONE_RECOVERY_FAILED\n');process.exitCode=1;});
