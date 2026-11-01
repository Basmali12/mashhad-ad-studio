import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {Store,hash} from '../engine/store.mjs';
import {buildFluxRequest} from '../engine/flux-prompt.mjs';
import {createFluxServices,createFluxRegistryAdapter,FLUX_MANIFEST} from '../engine/flux-integration.mjs';
import {createFluxImageAssets} from '../engine/flux-image-assets.mjs';
import {createEngineRegistry} from '../engine/engine-registry.mjs';
import {createProductionModels} from '../engine/production-models.mjs';
import {createProductionEngine} from '../engine/production-engine.mjs';

const actor={isAdmin:true},scope={customerId:'customer',projectId:'project',attemptId:'attempt'};
const character={id:'zainab',name:'زينب',description:'طبيبة عراقية معاصرة',age:30,face:'وجه بيضوي وعيون بنية',body:'متوسطة القامة',wardrobe:'معطف أزرق',props:[{id:'book',description:'دفتر أحمر صغير'}],referenceIds:[],angles:['main_face','full_body','front','side','three_quarter'],voice:{engineId:'habibi-irq',voiceId:'zainab-fixed',locale:'ar-IQ'},relationships:[]};
function png(width,height){
 const crc=b=>{let c=0xffffffff;for(const v of b){c^=v;for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1;}return (c^0xffffffff)>>>0;};
 const chunk=(name,data)=>{const type=Buffer.from(name),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(data.length);checksum.writeUInt32BE(crc(Buffer.concat([type,data])));return Buffer.concat([length,type,data,checksum]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;const pixels=Buffer.alloc((1+width*3)*height);for(let y=0;y<height;y++)pixels[y*(1+width*3)]=0;
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
function storyboard(durationMs=60000){return {id:'flux-film',orientation:'portrait',story:'قصة واقعية عن طبيبة',durationMs,characters:[structuredClone(character)],utterances:[],shots:[{id:'clinic',startMs:0,endMs:durationMs/2,prompt:'تفتح زينب باب عيادة حديثة',location:'عيادة عراقية معاصرة',characterIds:['zainab'],referenceIds:[],utteranceIds:[],eventIds:['arrives']},{id:'street',startMs:durationMs/2,endMs:durationMs,prompt:'تخرج زينب وهي تحمل الدفتر الأحمر',location:'شارع عراقي معاصر',characterIds:['zainab'],referenceIds:[],utteranceIds:[],eventIds:['leaves']}]};}
async function fixture(t,{allowPaid=true}={}){
 const folder=await mkdtemp(path.join(tmpdir(),'flux-full-')),store=new Store(folder,randomBytes(32).toString('base64'));t.after(async()=>{store.close();await rm(folder,{recursive:true,force:true});});let time=1000000;
 const accountId=randomUUID(),calls=[];store.put('account',{id:accountId,mode:'token',workspace:'synthetic-only',activated:false,credentials:store.seal({tokenId:'ak-synthetic-12345678',tokenSecret:'as-synthetic-12345678'},accountId)});
 const transport={inspect:async({definition:e})=>({accountId:e.accountId,volume:e.volume,weightPath:e.weightPath,revision:FLUX_MANIFEST.revision,deploymentReady:true,files:FLUX_MANIFEST.files.map(f=>({...f,verified:true}))}),start:async({definition:e,runId})=>{calls.push('start');return {engineId:e.id,accountId:e.accountId,runId,ready:true,cloudStopped:false};},observe:async({definition:e,runId})=>({engineId:e.id,accountId:e.accountId,runId,ready:true,cloudStopped:false}),stop:async({definition:e,runId})=>{calls.push('stop');time+=1500;return {engineId:e.id,accountId:e.accountId,runId,cloudStopped:true,activeTasks:0,admissionClosed:true,startSettled:true};},generate:async({definition:e,scope,runId,request,onProgress})=>{calls.push({request,scope});await onProgress?.({completed:4,total:4,unit:'steps'});const image=png(request.width,request.height);return {scope:{...scope,engineId:e.id,accountId:e.accountId,runId},modelRevision:FLUX_MANIFEST.revision,imageBase64:image.toString('base64'),sha256:hash(image)};},prepareQuote:async()=>({id:'provider-quote',expectedBytes:FLUX_MANIFEST.totalBytes,missingBytes:FLUX_MANIFEST.totalBytes,fileCount:17,dispatchAvailable:true,blockers:[],estimate:{resourceWindowUSD:.158256,recordedUSD:null,windowSeconds:3600,expectedSeconds:null,note:'fixture'}}),prepare:async()=>{calls.push('prepare');return {operationId:'operation',status:'submitted',cloudStopped:false};},observePreparation:async()=>({status:'completed',cloudStopped:true}),cancelPreparation:async()=>({status:'cancelled',cloudStopped:true})};
 const images=createFluxImageAssets({store,now:()=>time}),flux=createFluxServices({store,images,transport,allowPaid,now:()=>time}),registry=createEngineRegistry({store,adapter:flux.registryAdapter,allowPaid,now:()=>time});
 const d=await registry.dispatch(actor,'admin.engine.save',{name:'FLUX اختبار',modelId:'flux2-klein-4b',version:'4B',accountId,gpu:'RTX-PRO-6000',cpu:4,ramGiB:64,minVramGiB:24,hourPriceUSD:'3'});await registry.dispatch(actor,'admin.engine.inspect',{id:d.id});// Explicit local fixture publication, never a real admin action.
 const published=store.get('engine-definition',d.id);store.put('engine-definition',{...published,publication:{approved:true,tested:true,revision:published.revision}});
 return {folder,store,accountId,calls,transport,images,flux,registry,d,now:()=>time};
}
test('structured prompt preserves requested era, identity and action; only explicit visible-text consent injects lettering',()=>{
 const r=buildFluxRequest({scope,subject:{...character,angle:'side'},scene:{place:'Baghdad',era:'1930s',description:'She opens an old wooden door'},camera:{lighting:'soft daylight',angle:'eye level'},orientation:'landscape'});
 assert.equal(r.settings.width,1280);assert.equal(r.settings.height,720);assert.equal(r.settings.num_inference_steps,4);assert.match(r.prompt,/1930s/);assert.match(r.prompt,/opens an old wooden door/);assert.ok(!r.prompt.includes('Requested visible text'));
 const modern=buildFluxRequest({scope,scene:{place:'Modern Baghdad',era:'present day'}});assert.ok(!modern.prompt.includes('1930s'));
 assert.throws(()=>buildFluxRequest({scope,scene:{place:'x'},requestedText:'شركة'}),/FLUX_TEXT_CONSENT_REQUIRED/);
 const lettering=buildFluxRequest({scope,scene:{place:'x'},allowText:true,requestedText:'شركة'});assert.match(lettering.prompt,/Requested visible text: شركة/);
 assert.throws(()=>buildFluxRequest({scope,scene:{place:'x'},referenceIds:['same','same']}),/INVALID_FLUX_REQUEST/);
});
test('software installation is separate from pinned files, paid switch and compatible resources',async t=>{
 const f=await fixture(t,{allowPaid:false}),entry=await f.registry.dispatch(actor,'admin.engine.status',{id:f.d.id});assert.equal(entry.softwareInstalled,true);assert.equal(entry.expectedBytes,FLUX_MANIFEST.totalBytes);assert.equal(entry.preparationState,'ready');assert.equal(entry.deploymentState,'deployed');assert.ok(entry.blockers.includes('PAID_DISABLED'));
 const q=await f.registry.dispatch(actor,'admin.engine.quote',{id:f.d.id,action:'start'});assert.equal(q.dispatchAvailable,false);await assert.rejects(f.registry.dispatch(actor,'admin.engine.start',{id:f.d.id,quoteId:q.id,requestId:'denied',approved:true}),/ENGINE_NOT_READY/);assert.deepEqual(f.calls,[]);
 const profile=createFluxRegistryAdapter({transport:f.transport}).profile(f.store.get('engine-definition',f.d.id));assert.equal(profile.manifest.revision,FLUX_MANIFEST.revision);assert.equal(profile.validateResources({...f.d,gpu:'L40S',cpu:4,ramGiB:32,minVramGiB:24}),true);assert.equal(profile.validateResources({...f.d,cpu:4,ramGiB:16,minVramGiB:12}),false);
});
test('preparation is one approved CPU operation; repeated clicks and status only follow it',async t=>{
 const f=await fixture(t),q=await f.registry.dispatch(actor,'admin.engine.quote',{id:f.d.id,action:'prepare'});assert.equal(q.expectedBytes,15975692643);assert.equal(f.calls.length,0);
 await assert.rejects(f.registry.dispatch(actor,'admin.engine.prepare',{id:f.d.id,quoteId:q.id,requestId:'prep'}),/ENGINE_APPROVAL_REQUIRED/);
 const input={id:f.d.id,quoteId:q.id,requestId:'prep',approved:true};await f.registry.dispatch(actor,'admin.engine.prepare',input);await f.registry.dispatch(actor,'admin.engine.prepare',input);const current=await f.registry.dispatch(actor,'admin.engine.status',{id:f.d.id});assert.equal(f.calls.filter(c=>c==='prepare').length,1);assert.equal(f.calls.filter(c=>c==='start').length,0);assert.equal(current.preparation.cloudStopped,true);
});
test('real local image storage integrates mocked FLUX character angles and reusable scene references with long-film plan',async t=>{
 const f=await fixture(t),models=createProductionModels({store:f.store,registry:f.registry,adapters:{'flux2-klein-4b':f.flux.productionAdapter},now:f.now});
 const engine=createProductionEngine({store:f.store,models,allowExecution:true,now:f.now,planner:{billingMode:'none',analyze:async()=>({}),plan:async()=>storyboard(600000)}});
 f.store.put('film-credit',{id:'lot',customerId:'customer',amount:1000000000,remaining:1000000000,expiresAt:f.now()+86400000,createdAt:f.now()});
 await engine.configure(actor,{bindings:{'flux2-klein-4b':f.d.id}});const p=await engine.create('customer',{requestId:'new',title:'فيلم اختبار طويل',story:'قصة عشر دقائق',durationMs:600000});await engine.plan('customer',{id:p.id});
 const full=await engine.quote('customer',{id:p.id});assert.equal(full.dispatchAvailable,false);const q=await engine.quote('customer',{id:p.id,phase:'images'});assert.equal(q.dispatchAvailable,true);assert.equal(q.stages.length,7);assert.equal(f.calls.length,0);
 await engine.approve('customer',{id:p.id,quoteId:q.id,requestId:'approved-images',approved:true});const before=f.store.get('film-credit','lot').remaining,result=await engine.run('customer',p.id);
 assert.equal(result.state,'planned');assert.deepEqual(result.completedPhases,['images']);assert.equal(result.durationMs,600000);assert.equal(f.calls.filter(c=>typeof c==='object').length,7);
 const imageCalls=f.calls.filter(c=>typeof c==='object');assert.equal(imageCalls[0].request.mode,'text_to_image');for(const c of imageCalls.slice(1))assert.ok(c.request.reference_images.length>=1);
 const refs=f.store.all('production-character-reference');assert.equal(refs.length,5);const primary=f.store.all('production-asset').find(a=>a.characterId==='zainab'&&a.angle==='mainface');assert.ok(primary);assert.equal(imageCalls.at(-1).request.reference_images[0].assetId,primary.id);assert.equal(imageCalls.at(-2).request.reference_images[0].assetId,primary.id);
 assert.equal(f.store.all('flux-image-request').every(r=>r.modelRevision===FLUX_MANIFEST.revision&&r.prompt.length>0&&r.settings.dtype==='bfloat16'),true);
 assert.equal(f.store.all('production-charge').every(r=>r.state==='settled'),true);assert.ok(f.store.get('film-credit','lot').remaining<before);const saved=f.store.all('production-asset')[0],original=await readFile(saved.path);assert.equal(hash(original),saved.sha256);
 const count=f.calls.length;await engine.run('customer',p.id);assert.equal(f.calls.length,count);await assert.rejects(f.images.read({customerId:'foreign',projectId:p.id,assetId:saved.id}),/NOT_FOUND/);
 assert.ok(result.stages.filter(s=>['animate','voice','merge','save'].includes(s.kind)).every(s=>s.state==='planned'));assert.ok(!f.calls.some(c=>typeof c==='object'&&c.request.modelId==='wan22-i2v-a14b'));
});
test('failed inference with confirmed stop settles elapsed customer meter and releases the unused estimate',async t=>{
 const f=await fixture(t);f.transport.generate=async()=>{throw Error('synthetic model failure');};const models=createProductionModels({store:f.store,registry:f.registry,adapters:{'flux2-klein-4b':f.flux.productionAdapter},now:f.now}),engine=createProductionEngine({store:f.store,models,allowExecution:true,now:f.now,planner:{billingMode:'none',analyze:async()=>({}),plan:async()=>storyboard()}});
 f.store.put('film-credit',{id:'lot',customerId:'customer',amount:1000000000,remaining:1000000000,expiresAt:f.now()+86400000,createdAt:f.now()});await engine.configure(actor,{bindings:{'flux2-klein-4b':f.d.id}});const p=await engine.create('customer',{requestId:'failure',title:'اختبار فشل',story:'قصة',durationMs:60000});await engine.plan('customer',{id:p.id});const q=await engine.quote('customer',{id:p.id,phase:'images'});await engine.approve('customer',{id:p.id,quoteId:q.id,requestId:'failure-approved',approved:true});const result=await engine.run('customer',p.id),[charge]=f.store.all('production-charge');
 assert.equal(result.state,'failed');assert.equal(result.error,'PRODUCTION_STAGE_FAILED');assert.equal(charge.state,'settled');assert.equal(charge.amountMicroUSD,1250);assert.equal(f.store.get('film-credit','lot').remaining,1000000000-1250);assert.ok(charge.heldMicroUSD>charge.amountMicroUSD);assert.equal(result.stages.find(s=>s.state==='failed').id,'character_image:zainab:0');assert.equal(f.store.all('production-asset').length,0);
});
test('a preview failure adopts the already-generated image through CPU follow-up without regenerating or charging twice',async t=>{
 const f=await fixture(t),originalGenerate=f.transport.generate,originalCommit=f.images.commit;let generated,reads=0,once=true;
 f.transport.generate=async input=>{generated=await originalGenerate(input);return generated;};f.transport.observeResult=async()=>{reads++;return generated;};f.images.commit=async input=>{if(once){once=false;throw Error('FLUX_IMAGE_PREVIEW_FAILED');}return originalCommit(input);};
 const models=createProductionModels({store:f.store,registry:f.registry,adapters:{'flux2-klein-4b':f.flux.productionAdapter},now:f.now}),engine=createProductionEngine({store:f.store,models,allowExecution:true,now:f.now,planner:{billingMode:'none',analyze:async()=>({}),plan:async()=>storyboard()}});
 f.store.put('film-credit',{id:'lot',customerId:'customer',amount:1000000000,remaining:1000000000,expiresAt:f.now()+86400000,createdAt:f.now()});await engine.configure(actor,{bindings:{'flux2-klein-4b':f.d.id}});const p=await engine.create('customer',{requestId:'preview-failure',title:'اختبار معاينة',story:'قصة',durationMs:60000});await engine.plan('customer',{id:p.id});const q=await engine.quote('customer',{id:p.id,phase:'images'});await engine.approve('customer',{id:p.id,quoteId:q.id,requestId:'preview-approved',approved:true});await engine.run('customer',p.id);
 assert.equal(f.store.all('flux-image-request')[0].state,'awaiting_local_commit');const before=f.store.get('film-credit','lot').remaining,calls=f.calls.length;const adopted=await engine.reconcile('customer',p.id,'character_image:zainab:0');assert.equal(adopted.stages.find(s=>s.id==='character_image:zainab:0').state,'completed');assert.equal(reads,1);assert.equal(f.calls.length,calls);assert.equal(f.store.get('film-credit','lot').remaining,before);assert.equal(f.store.all('production-charge').length,1);assert.equal(f.store.all('production-asset').length,1);
});
