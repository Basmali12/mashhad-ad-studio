import {hash} from './store.mjs';
import {ENGINE_MODEL_CATALOG} from '../../../shared/engine-catalog.ts';
import {engineRuntimeDefaults} from './engine-policy.mjs';

const MODEL_IDS=['flux2-klein-4b','qwen-image-edit-2511','wan22-i2v-a14b','habibi-msa','habibi-irq','habibi-egy'];
/** Explicit local administrative migration. Never prepares, inspects cloud files,
 * starts hardware, publishes untested engines or changes wallet/account records. */
export async function bindExistingSlots({store,approved=false,primaryWorkspace='basm1998ali',now=Date.now}){
 if(approved!==true)throw Error('APPROVAL_REQUIRED');
 return store.transaction(async()=>{
  const slots=(await store.all('film-slot')).filter(s=>!s.retired);
  const accounts=new Map((await store.all('account')).map(a=>[a.id,a]));
  for(const s of slots){
   if((await store.all('rental')).some(r=>r.accountId===s.accountId&&r.state!=='closed')||
      (await store.all('engine-runtime')).some(r=>r.accountId===s.accountId&&r.cloudStopped!==true)||
      (await store.all('engine-test')).some(r=>r.accountId===s.accountId&&r.cloudStopped!==true)||
      (await store.all('job')).some(j=>(j.accountId===s.accountId||j.sourceId===s.accountId)&&j.cloudStopped!==true&&['start','generate','prepare'].includes(j.action)))throw Error('ACCOUNT_IN_USE');
   const a=accounts.get(s.accountId);if(!a||a.unlinked||a.mode!=='token'||!a.credentials)throw Error('ACCOUNT_LINK_REQUIRED');
  }
  const linked=[];
  for(const s of slots){
   if(s.genericEngineId){const existing=await store.get('engine-definition',s.genericEngineId);if(!existing||existing.accountId!==s.accountId)throw Error('ENGINE_BINDING_MISMATCH');linked.push({slotId:s.id,engineId:existing.id,reused:true});continue;}
   const bindings={};
   for(const modelId of MODEL_IDS){
    // Separate video runtime per card; reusable image/audio definitions per account.
    const owner=modelId==='wan22-i2v-a14b'?s.id:s.accountId;
    const key=hash('slot-model-link-v1:'+owner+':'+modelId);
    const link=await store.get('slot-model-link',key);
    let e=link?await store.get('engine-definition',link.engineId):null;
    if(e&&(e.accountId!==s.accountId||e.modelId!==modelId))throw Error('ENGINE_BINDING_MISMATCH');
    if(!e){
     const defaults=engineRuntimeDefaults(modelId);
     const model=ENGINE_MODEL_CATALOG.find(m=>m.id===modelId);if(!model?.version)throw Error('MODEL_VERSION_REQUIRED');
     const engineId=key;
     if(await store.get('engine-definition',engineId))throw Error('ENGINE_BINDING_MISMATCH');
     e={id:engineId,name:(s.name+' · '+modelId).slice(0,120),modelId,version:model.version,accountId:s.accountId,gpu:defaults.gpu,cpu:defaults.cpu,ramGiB:defaults.ramGiB,minVramGiB:defaults.minVramGiB,volume:'mashhad-models-'+s.accountId.slice(0,12),weightPath:`models/${modelId}/${engineId}`,hourMicros:s.hourMicros,revision:1};
     await store.put('engine-definition',e);
     await store.put('slot-model-link',{id:key,engineId:e.id,accountId:s.accountId,modelId,createdAt:now()});
    }
    bindings[modelId]=e.id;
   }
   const e=await store.get('engine-definition',bindings['wan22-i2v-a14b']);
   e.rentalSlotId=s.id;await store.put('engine-definition',e);
   await store.put('film-slot',{...s,genericEngineId:e.id,modelId:e.modelId,modelBindings:bindings,locked:true,revision:(s.revision??0)+1,newEngineLinkedAt:now()});
   if(accounts.get(s.accountId).workspace===primaryWorkspace){
    const config=await store.get('production-settings','models')??{id:'models',bindings:{},modelSettings:{}};
    for(const [modelId,id] of Object.entries(bindings))if(!config.bindings?.[modelId])config.bindings={...(config.bindings??{}),[modelId]:id};
    await store.put('production-settings',{...config,updatedAt:now()});
   }
   await store.audit('slot_linked_to_new_models',s.id);linked.push({slotId:s.id,engineId:e.id,reused:false});
  }
  return {linked,paidOperations:0,publishedWithoutTest:0};
 });
}

/** Called only by commissioning after its real evidence/licence approval checks. */
export function newEngineSlotPublication(e,publication,previous){
 if(e.rentalSlotId&&(!previous||previous.id!==e.rentalSlotId||previous.accountId!==e.accountId||previous.genericEngineId!==e.id||previous.retired))throw Error('ENGINE_BINDING_MISMATCH');
 return {...previous,id:e.rentalSlotId??e.id,genericEngineId:e.id,modelId:e.modelId,accountId:e.accountId,name:e.rentalSlotId?previous.name:e.name,gpu:e.gpu,ram:e.ramGiB,cpu:e.cpu,settings:{gpu:e.gpu,cpu:e.cpu,ram:e.ramGiB},hourMicros:e.hourMicros,revision:e.revision,published:true,locked:false,testingOnly:false,retired:false,publicationTestId:publication.testId};
}
