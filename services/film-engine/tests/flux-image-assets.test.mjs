import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {deflateSync,crc32} from 'node:zlib';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Store,hash} from '../engine/store.mjs';
import {createFluxImageAssets} from '../engine/flux-image-assets.mjs';

const exec=promisify(execFile);
test('Qwen edits preserve immutable FLUX originals and store explicit owned lineage',async t=>{
 const f=await fixture(t),original=await f.assets.commit(f.input),profile={modelId:'qwen-image-edit-2511',version:'2511',revision:'b'.repeat(40)},qwen=createFluxImageAssets({store:f.store,modelProfile:profile,makePreview:async()=>png(8,6)}),attempt=f.attempt({id:'qwen-attempt',stageId:'scene_image:shot-one',kind:'scene_image',subjectId:'shot-one'}),stage=f.store.get('production-stage',hash('project-one:'+attempt.stageId));f.store.put('production-stage',{...stage,modelId:profile.modelId});
 const {characterId,angle,...base}=f.input;void characterId;void angle;const input={...base,...attempt,shotId:'shot-one',bytes:png(32,24,180),request:{...base.request,modelId:profile.modelId,modelVersion:profile.version,revision:profile.revision,referenceIds:[original.assetId]}};
 const edited=await qwen.commit(input);assert.equal(edited.modelId,profile.modelId);assert.deepEqual(edited.lineage,{kind:'edited',sourceAssetIds:[original.assetId],rootAssetIds:[original.assetId]});assert.deepEqual((await f.assets.read({customerId:'alice',projectId:'project-one',assetId:original.assetId})).bytes,f.input.bytes);assert.equal(edited.qualityCertified,false);assert.equal(f.store.get('production-asset',edited.assetId).generatedBy,'qwen-image-assets-v1');
 await assert.rejects(qwen.commit({...input,attemptId:'missing',request:{...input.request,referenceIds:[]}}),/REFERENCE_REQUIRED|ATTEMPT/);await assert.rejects(qwen.commit({...input,request:{...input.request,revision:'c'.repeat(40)}}),/REQUEST_INVALID/);
});
function png(width=32,height=24,red=100){const chunk=(type,data)=>{const b=Buffer.concat([Buffer.from(type),data]),size=Buffer.alloc(4),check=Buffer.alloc(4);size.writeUInt32BE(data.length);check.writeUInt32BE(crc32(b));return Buffer.concat([size,b,check]);},head=Buffer.alloc(13);head.writeUInt32BE(width);head.writeUInt32BE(height,4);head[8]=8;head[9]=2;const pixels=Buffer.alloc((width*3+1)*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++)pixels[y*(width*3+1)+1+x*3]=red;return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',head),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);}
async function fixture(t,{makePreview}={}){
 const folder=await fs.mkdtemp(path.join(tmpdir(),'flux-images-')),store=new Store(folder,randomBytes(32).toString('base64'));let previews=0;
 store.put('production-project',{id:'project-one',customerId:'alice',state:'running',plan:{characters:[{id:'zeinab',name:'زينب',angles:['front','mainface','fullbody','side','threequarter']}],shots:[{id:'shot-one'}]}});
 function attempt({id='attempt-one',stageId='character_image:zeinab:0',kind='character_image',subjectId='zeinab',angleIndex=0,status='running'}={}){store.put('production-attempt',{id,projectId:'project-one',customerId:'alice',stageId,status});store.put('production-stage',{id:hash('project-one:'+stageId),projectId:'project-one',customerId:'alice',stageId,kind,subjectId,angleIndex,modelId:'flux2-klein-4b',state:'running',attemptId:id});return {attemptId:id,stageId};}
 const input={customerId:'alice',projectId:'project-one',...attempt(),characterId:'zeinab',angle:'front',bytes:png(),expectedWidth:32,expectedHeight:24,request:{modelId:'flux2-klein-4b',modelVersion:'2-klein-4B',revision:'a'.repeat(40),prompt:'A fictional Iraqi woman in a modern courtyard.',settings:{seed:42,width:32,height:24,steps:4},referenceIds:[]}};
 const assets=createFluxImageAssets({store,makePreview:makePreview||(async()=>{previews++;return png(8,6);})});
 t.after(async()=>{store.close();await fs.rm(folder,{recursive:true,force:true});});return {store,folder,assets,input,attempt,previews:()=>previews};
}
test('commits immutable original and thumbnail once, stores only metadata and appends an honest character reference',async t=>{
 const f=await fixture(t),[a,b]=await Promise.all([f.assets.commit(f.input),f.assets.commit(f.input)]);assert.equal(a.assetId,b.assetId);assert.equal(f.previews(),1);assert.equal(a.sha256,hash(f.input.bytes));assert.equal(a.kind,'image');assert.equal(a.identityVerified,false);assert.equal(a.qualityCertified,false);assert.ok(!JSON.stringify(a).includes(f.folder));assert.ok(!JSON.stringify(a).includes(f.input.request.prompt));
 const original=await f.assets.read({customerId:'alice',projectId:'project-one',assetId:a.assetId});assert.deepEqual(original.bytes,f.input.bytes);assert.equal(original.path,path.join(f.folder,'production-assets','project-one',a.assetId,'image.png'));const preview=await f.assets.read({customerId:'alice',projectId:'project-one',assetId:a.assetId,preview:true});assert.equal(preview.metadata.preview.width,8);assert.deepEqual(preview.bytes,png(8,6));
 assert.equal((await f.assets.reference({customerId:'alice',projectId:'project-one',assetId:a.assetId,preview:true})).path,original.path);assert.equal((await f.assets.commit(f.input)).assetId,a.assetId);assert.equal(f.previews(),1);
 const refs=f.store.all('production-character-reference');assert.equal(refs.length,1);assert.equal(refs[0].characterId,'zeinab');assert.equal(refs[0].angle,'front');assert.equal(refs[0].identityVerified,false);const saved=f.store.get('production-asset',a.assetId);assert.equal(saved.request.prompt,f.input.request.prompt);assert.ok(!Object.values(saved).some(v=>Buffer.isBuffer(v)));
});
test('character angles append without replacing earlier references and scene images can reuse their owned IDs',async t=>{
 const f=await fixture(t),first=await f.assets.commit(f.input),second=await f.assets.commit({...f.input,...f.attempt({id:'attempt-two',stageId:'character_image:zeinab:1',angleIndex:1}),angle:'main_face',bytes:png(32,24,150)});assert.notEqual(first.assetId,second.assetId);assert.equal(f.store.all('production-character-reference').length,2);assert.equal(second.angle,'mainface');
 const {characterId,angle,...shot}=f.input;void characterId;void angle;const result=await f.assets.commit({...shot,...f.attempt({id:'attempt-shot',stageId:'scene_image:shot-one',kind:'scene_image',subjectId:'shot-one'}),shotId:'shot-one',request:{...f.input.request,referenceIds:[first.assetId,second.assetId]}});assert.equal(result.shotId,'shot-one');assert.equal(f.store.all('production-character-reference').length,2);
});
test('foreign ownership, stale attempt, cancelled work and mismatched character roles cannot commit',async t=>{
 const f=await fixture(t);await assert.rejects(f.assets.commit({...f.input,customerId:'bob'}),/NOT_FOUND/);await assert.rejects(f.assets.commit({...f.input,characterId:'another'}),/CHARACTER_MISMATCH/);await assert.rejects(f.assets.commit({...f.input,angle:'side'}),/CHARACTER_MISMATCH/);
 f.store.put('production-attempt',{...f.store.get('production-attempt','attempt-one'),status:'completed'});await assert.rejects(f.assets.commit(f.input),/ATTEMPT_NOT_ACTIVE/);f.store.put('production-attempt',{...f.store.get('production-attempt','attempt-one'),status:'running'});f.store.put('production-project',{...f.store.get('production-project','project-one'),cancelRequested:true});await assert.rejects(f.assets.commit(f.input),/CANCELLED/);assert.equal(f.previews(),0);assert.equal(f.store.all('production-asset').length,0);
});
test('dimensions, corrupted pixels, secret settings and unowned references reject without preview generation',async t=>{
 const f=await fixture(t);await assert.rejects(f.assets.commit({...f.input,expectedWidth:720}),/DIMENSIONS/);const bad=Buffer.from(f.input.bytes);bad[bad.length-10]^=1;await assert.rejects(f.assets.commit({...f.input,bytes:bad}),/REFERENCE_INVALID/);
 await assert.rejects(f.assets.commit({...f.input,request:{...f.input.request,settings:{tokenSecret:'not-a-secret-fixture'}}}),/REQUEST_INVALID/);await assert.rejects(f.assets.commit({...f.input,request:{...f.input.request,referenceIds:['foreign-reference']}}),/REFERENCE_NOT_OWNED/);assert.equal(f.previews(),0);
});
test('one attempt cannot replace original pixels or metadata, and changed stored files are not reusable',async t=>{
 const f=await fixture(t),saved=await f.assets.commit(f.input);await assert.rejects(f.assets.commit({...f.input,bytes:png(32,24,180)}),/ALREADY_COMMITTED/);await assert.rejects(f.assets.commit({...f.input,request:{...f.input.request,prompt:'Changed request'}}),/ALREADY_COMMITTED/);assert.equal(f.previews(),1);
 await assert.rejects(f.assets.read({customerId:'bob',projectId:'project-one',assetId:saved.assetId}),/NOT_FOUND/);const row=f.store.get('production-asset',saved.assetId);await fs.appendFile(row.path,'corrupt');await assert.rejects(f.assets.reference({customerId:'alice',projectId:'project-one',assetId:saved.assetId}),/ARTIFACT_CHANGED/);
});
test('directory junctions cannot redirect image storage into another service',async t=>{
 const f=await fixture(t),outside=await fs.mkdtemp(path.join(tmpdir(),'flux-image-outside-'));t.after(()=>fs.rm(outside,{recursive:true,force:true}));await fs.writeFile(path.join(outside,'keep.txt'),'unchanged');await fs.symlink(outside,path.join(f.folder,'production-assets'),process.platform==='win32'?'junction':'dir');await assert.rejects(f.assets.commit(f.input),/UNSAFE_PATH/);assert.equal(await fs.readFile(path.join(outside,'keep.txt'),'utf8'),'unchanged');assert.equal(f.previews(),0);
});
test('default CPU preview validates PNG, JPEG and WebP originals without changing their bytes',async t=>{
 const binary=process.env.ENGINE_FFMPEG_BIN||'ffmpeg';try{await exec(binary,['-version']);}catch{t.skip('Existing local FFmpeg unavailable; no download');return;}
 for(const extension of ['png','jpg','webp']){const f=await fixture(t),source=path.join(f.folder,'fixture.'+extension);if(extension==='png')await fs.writeFile(source,png());else await exec(binary,['-v','error','-f','lavfi','-i','color=c=blue:s=32x24','-frames:v','1',source]);const bytes=await fs.readFile(source),assets=createFluxImageAssets({store:f.store}),saved=await assets.commit({...f.input,bytes});assert.equal(saved.width,32);assert.equal(saved.height,24);assert.ok(saved.preview.width<=32);assert.deepEqual((await assets.read({customerId:'alice',projectId:'project-one',assetId:saved.assetId})).bytes,bytes);}
});
test('preview failure preserves the private original and the same result can complete by CPU retry only',async t=>{
 let fail=true;const f=await fixture(t,{makePreview:async()=>{if(fail)throw Error('LOCAL_PREVIEW_FIXTURE_FAILURE');return png(8,6);}});await assert.rejects(f.assets.commit(f.input),/LOCAL_PREVIEW_FIXTURE_FAILURE/);assert.equal(f.store.all('production-asset').length,0);assert.equal(f.store.all('production-character-reference').length,0);
 const intent=f.store.get('production-image-intent',f.input.attemptId),file=path.join(f.folder,'production-assets','project-one',intent.assetId,'image.png');assert.equal(intent.state,'failed');assert.deepEqual(await fs.readFile(file),f.input.bytes);await assert.rejects(f.assets.commit({...f.input,bytes:png(32,24,160)}),/ALREADY_COMMITTED/);fail=false;assert.equal((await f.assets.commit(f.input)).sha256,hash(f.input.bytes));
});
test('uploaded references bind owned original checksums and are reusable in multiple scenes without copying them',async t=>{
 const f=await fixture(t),upload=png(),id='uploaded-reference',sourceId='source-conversation',folder=path.join(f.folder,'film-references',sourceId);await fs.mkdir(folder,{recursive:true});const file=path.join(folder,id+'.image');await fs.writeFile(file,upload);
 f.store.put('film-reference-retained',{id,customerId:'alice',projectId:sourceId,size:upload.length});f.store.put('film-project',{id:sourceId,customerId:'alice',reference:{id,mime:'image/png',width:32,height:24,sha256:hash(upload)}});
 const loaded=await f.assets.loadReference({customerId:'alice',projectId:'project-one',assetId:id});assert.deepEqual(loaded.bytes,upload);assert.equal(loaded.sha256,hash(upload));assert.ok(!('path' in loaded));assert.equal(f.store.all('production-reference-binding')[0].provenance,'upload_metadata');
 const p=f.store.get('production-project','project-one');p.plan.shots.push({id:'shot-two'});f.store.put('production-project',p);const {characterId,angle,...base}=f.input;void characterId;void angle;
 for(const [index,shotId] of ['shot-one','shot-two'].entries()){const result=await f.assets.commit({...base,...f.attempt({id:'shot-attempt-'+index,stageId:'scene_image:'+shotId,kind:'scene_image',subjectId:shotId}),shotId,request:{...base.request,referenceIds:[id]}});assert.deepEqual(result.referenceIds,[id]);}
 assert.equal(f.store.all('production-reference-binding').length,1);assert.deepEqual(await fs.readFile(file),upload);await assert.rejects(f.assets.loadReference({customerId:'bob',projectId:'project-one',assetId:id}),/NOT_FOUND/);await fs.writeFile(file,png(32,24,155));await assert.rejects(f.assets.loadReference({customerId:'alice',projectId:'project-one',assetId:id}),/ARTIFACT_CHANGED/);
});
test('old retained references without upload checksums get an explicit first-observed binding and reject subsequent mutation',async t=>{
 const f=await fixture(t),id='old-upload',sourceId='old-conversation',folder=path.join(f.folder,'film-references',sourceId),bytes=png();await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,id+'.image'),bytes);f.store.put('film-reference-retained',{id,customerId:'alice',projectId:sourceId,size:bytes.length});f.store.put('film-project',{id:sourceId,customerId:'alice',reference:null});
 await f.assets.loadReference({customerId:'alice',projectId:'project-one',assetId:id});assert.equal(f.store.all('production-reference-binding')[0].provenance,'first_observed_local_file');f.store.put('film-project',{id:sourceId,customerId:'bob',reference:null});await assert.rejects(f.assets.loadReference({customerId:'alice',projectId:'project-one',assetId:id}),/REFERENCE_NOT_OWNED/);
});
