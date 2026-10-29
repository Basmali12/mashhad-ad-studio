import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {Store} from '../engine/store.mjs';
import {OpenAIDirector,TEXT_MODEL} from '../engine/openai-director.mjs';
import {parseVisualReview,extractReviewFrames} from '../engine/film-review.mjs';
import {createFilmPlatform} from '../engine/film-platform.mjs';

const assessment={nextVisualPrompt:null,summary:'توجد كتابة في إحدى العينات.',visibleText:'detected',continuity:'unknown',causalOrder:'unknown',audioAssessment:'not_checked',findings:['الكتابة مرئية أسفل الصورة.'],suggestedCorrections:['استعمل خلفية خالية من اللافتات.']};
const finish=async director=>{await Promise.all([...director.pending]);};
async function fixture(t){
 const folder=await mkdtemp(path.join(tmpdir(),'film-review-')),store=new Store(folder,randomBytes(32).toString('base64'));
 const cleanup=[];t.after(async()=>{for(const fn of cleanup)await fn();store.close();await rm(folder,{recursive:true,force:true});});
 store.put('config',{id:'openai-director',credentials:store.seal({key:'synthetic-key-never-network'},'openai-director')});
 const job={id:'job-one',projectId:'project-one',tenantId:'owner-one',status:'completed',result:{videoVerified:true,sha256:'a'.repeat(64)},prompt:'A man opens a door before reacting.'};store.put('job',job);
 return {store,folder,job,cleanup};
}
test('sample review uses actual image payload, exact Terra rates, preserves video and never claims audio checks',async t=>{
 const {store,job}=await fixture(t);let calls=0,loads=0;
 const frames=Array.from({length:6},(_,i)=>({timestamp:i,data:'data:image/jpeg;base64,/9j/2Q=='}));
 const director=new OpenAIDirector(store,{frameLoader:async()=>{loads++;return frames;},fetcher:async(url,opt)=>{
  calls++;assert.equal(url,'https://api.openai.com/v1/responses');const p=JSON.parse(opt.body);
  assert.equal(p.model,'gpt-6.1-terra');assert.equal(p.store,false);
  assert.equal(p.input[0].content.filter(x=>x.type==='input_image').length,6);
  assert.match(p.instructions,/NO audio input/);assert.match(p.instructions,/untrusted/);
  return Response.json({status:'completed',usage:{input_tokens:20000,input_tokens_details:{cached_tokens:0},output_tokens:6000},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(assessment)}]}]});
 }});
 const b={requestId:'review-one',projectId:job.projectId,jobId:job.id,approvedTextCost:true};
 await director.review(b);await finish(director);const result=await director.get(b.requestId);
 assert.equal(result.status,'completed');assert.equal(result.usage.computedUSD,.05);assert.equal(result.invoiceUSD,null);
 assert.equal(result.visualReview.audioAssessment,'not_checked');assert.equal(result.evidence.audioChecked,false);
 assert.equal(JSON.stringify(result).includes('base64'),false);assert.deepEqual(store.get('job',job.id),job);
 await director.review(b);assert.equal(calls,1);assert.equal(loads,1);await director.close();
});
test('no approval, unverified video, wrong project and direct browser-like review payload fail before network',async t=>{
 const {store,job}=await fixture(t);let calls=0;
 const director=new OpenAIDirector(store,{fetcher:async()=>{calls++;throw Error('NO_NETWORK');}});
 await assert.rejects(director.review({}),/APPROVAL/);
 await assert.rejects(director.review({approvedTextCost:true,requestId:'r',projectId:'wrong',jobId:job.id}),/VERIFIED_VIDEO/);
 await assert.rejects(director.submit({approvedTextCost:true,requestId:'r',projectId:job.projectId,mode:'review',images:['https://untrusted.test']}),/INVALID_DIRECTOR/);
 assert.equal(calls,0);await director.close();
});
test('malformed review cannot claim audio validation; timeout is uncertain and never retried',async t=>{
 assert.throws(()=>parseVisualReview(JSON.stringify({...assessment,audioAssessment:'perfect_iraqi'})),/INVALID/);
 const {store,job}=await fixture(t);let calls=0;
 const director=new OpenAIDirector(store,{frameLoader:async()=>[],fetcher:async()=>{calls++;throw Error('synthetic timeout');}});
 const b={requestId:'timeout-review',projectId:job.projectId,jobId:job.id,approvedTextCost:true};
 await director.review(b);await finish(director);assert.equal((await director.get(b.requestId)).status,'uncertain');
 await director.review(b);assert.equal(calls,1);await director.close();
});
test('concurrent projects claim one provider call before asynchronous persistence; unavailable model has no fallback',async t=>{
 const {store}=await fixture(t);let calls=0;
 const director=new OpenAIDirector(store,{fetcher:async()=>{calls++;return Response.json({error:{code:'model_not_found'}},{status:404});}});
 const b={projectId:'p',mode:'brief',approvedTextCost:true,messages:[{role:'user',content:'قصة عراقية'}]};
 const results=await Promise.allSettled([director.submit({...b,requestId:'a'}),director.submit({...b,requestId:'b',projectId:'q'})]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);await finish(director);
 assert.equal(calls,1);const r=store.all('text-call')[0];assert.equal(r.error,'OPENAI_MODEL_UNAVAILABLE');assert.equal(r.model,TEXT_MODEL);await director.close();
});
test('platform review is owned, explicit, one durable intent, separate budget and no GPU or mutation of generation',async t=>{
 const {store,cleanup}=await fixture(t);let reviews=0;const actor={id:'alice',email:'alice@fixture.test'};
 const engine={store,allowPaid:false,invoke:async(route,b)=>{
  if(route==='llm/reviews'){reviews++;assert.equal(b.approvedTextCost,true);return {status:'queued'};}
  if(route.startsWith('llm/calls/'))return {status:'completed',model:TEXT_MODEL,visualReview:assessment,evidence:{timestamps:[0,2,4,6,8,9.75]},usage:{computedUSD:.05}};
  throw Error('UNEXPECTED_GPU_OR_PROVIDER_CALL');
 }};
 const platform=createFilmPlatform({engine,origin:'https://fixture.test',secret:'synthetic-bridge-secret-at-least-32-chars',startWorker:false,textEnabled:true,textBudgetMicroUSD:1000000});
 cleanup.push(()=>platform.close());
 const customer=(await platform.dispatch(actor,'session')).user.id;
 const job={id:'owned-job',projectId:'owned-project',tenantId:customer,status:'completed',result:{videoVerified:true,sha256:'b'.repeat(64)}};store.put('job',job);
 store.put('film-project',{id:'owned-project',customerId:customer,name:'قصة',story:'قصة عراقية',seconds:10,state:'completed',scenes:[{jobId:job.id,status:'done'}]});
 await assert.rejects(platform.dispatch({...actor,id:'bob'},'review.submit',{projectId:'owned-project',approved:true}),/NOT_FOUND/);
 await assert.rejects(platform.dispatch(actor,'review.submit',{projectId:'owned-project'}),/APPROVAL/);
 const input={projectId:'owned-project',approved:true};await Promise.all([platform.dispatch(actor,'review.submit',input),platform.dispatch(actor,'review.submit',input)]);
 for(let i=0;i<20&&store.get('film-project','owned-project').reviewPending;i++)await new Promise(r=>setTimeout(r,5));
 const p=await platform.dispatch(actor,'project.get',{id:'owned-project'});assert.equal(p.reviewState,'completed');assert.equal(p.state,'completed');assert.equal(p.visualReviews[0].sampleCount,6);assert.equal(p.visualReviews[0].invoiceUSD,null);
 await platform.dispatch(actor,'review.submit',input);assert.equal(reviews,1);assert.equal(store.all('film-text-reservation').length,1);assert.deepEqual(store.get('job',job.id),job);
});
test('restart marks pending review for follow only; budget rejection makes no request',async t=>{
 const {store,cleanup}=await fixture(t);let calls=0;
 const engine={store,invoke:async()=>{calls++;throw Error('NO_NETWORK');}};
 const platform=createFilmPlatform({engine,origin:'https://fixture.test',secret:'synthetic-secret-at-least-32-characters',startWorker:false,textEnabled:true,textBudgetMicroUSD:1});cleanup.push(()=>platform.close());
 const actor={id:'alice',email:'alice@fixture.test'},customer=(await platform.dispatch(actor,'session')).user.id;
 store.put('job',{id:'j',tenantId:customer,projectId:'p',result:{videoVerified:true,sha256:'a'.repeat(64)}});
 store.put('film-project',{id:'p',customerId:customer,name:'قصة',scenes:[{jobId:'j'}]});
 await assert.rejects(platform.dispatch(actor,'review.submit',{projectId:'p',approved:true}),/TEXT_BUDGET_LIMIT/);assert.equal(calls,0);
 store.put('film-project',{...store.get('film-project','p'),reviewPending:'interrupted',reviewState:'running'});
 const restarted=createFilmPlatform({engine,origin:'https://fixture.test',secret:'synthetic-secret-at-least-32-characters',startWorker:false,textEnabled:true,textBudgetMicroUSD:1000000});cleanup.push(()=>restarted.close());
 await restarted.dispatch(actor,'review.submit',{projectId:'p',approved:true});assert.equal(store.get('film-project','p').reviewState,'needs_review');assert.equal(calls,0);
});
test('real local MP4 extraction produces six timestamped JPEGs and detects changed source',async t=>{
 const ffmpeg=process.env.ENGINE_FFMPEG_BIN||'ffmpeg';
 const probe=spawnSync(ffmpeg,['-version'],{windowsHide:true,stdio:'ignore'});
 if(probe.status!==0)return t.skip('FFmpeg unavailable; extraction runtime not verified');
 const {store,folder}=await fixture(t),dir=path.join(folder,'artifacts','real-job');await mkdir(dir,{recursive:true});
 const file=path.join(dir,'video.mp4');const made=spawnSync(ffmpeg,['-v','error','-f','lavfi','-i','color=c=blue:s=160x288:r=24','-t','10','-c:v','libx264',file],{windowsHide:true,stdio:'ignore'});assert.equal(made.status,0);
 const bytes=await readFile(file),job={id:'real-job',quality:{seconds:10},result:{videoVerified:true,sha256:createHash('sha256').update(bytes).digest('hex')}};
 const images=await extractReviewFrames({folder,job,ffmpeg});assert.equal(images.length,6);assert.equal(images[0].timestamp,0);assert.equal(images[5].timestamp,9.75);assert.ok(images.every(i=>i.data.startsWith('data:image/jpeg;base64,/9j/')));
 await writeFile(file,Buffer.from('changed'));await assert.rejects(extractReviewFrames({folder,job,ffmpeg}),/ARTIFACT_CHANGED/);
});

test('chat planning receives only the current project opening image and never persists inline image bytes',async t=>{
 const {store,folder,cleanup}=await fixture(t);const {deflateSync,crc32}=await import('node:zlib');
 const chunk=(type,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);b.writeUInt32BE(crc32(b.subarray(4,-4)),b.length-4);return b;};
 const header=Buffer.alloc(13);header.writeUInt32BE(2);header.writeUInt32BE(2,4);header[8]=8;header[9]=6;
 const bytes=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc(18))),chunk('IEND',Buffer.alloc(0))]);
 await mkdir(path.join(folder,'film-references','portrait-project'),{recursive:true});await writeFile(path.join(folder,'film-references','portrait-project','portrait-one.image'),bytes);
 store.put('film-project',{id:'portrait-project',customerId:'owner',reference:{id:'portrait-one',mime:'image/png',sha256:createHash('sha256').update(bytes).digest('hex')}});
 let calls=0;const director=new OpenAIDirector(store,{fetcher:async(url,opt)=>{calls++;const payload=JSON.parse(opt.body);assert.ok(payload.input.at(-1).content.some(c=>c.type==='input_image'&&c.image_url==='data:image/png;base64,'+bytes.toString('base64')));return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'نستخدم صورة البداية، من الشخصية؟',proposed_duration_seconds:20,style:'realistic',ready_to_write:false,missing:[],portrait_prompt:null,continuity_notes:'Opening image supplied.'})}]}]});}});cleanup.push(()=>director.close());
 const input={requestId:'portrait-discuss',projectId:'portrait-project',mode:'discuss',approvedTextCost:true,messages:[{role:'user',content:'هذه زينب، نريد عشرين ثانية'}]};await director.submit(input);await finish(director);assert.equal((await director.get(input.requestId)).status,'completed');await director.submit(input);assert.equal(calls,1);assert.equal(JSON.stringify(store.all('text-call')).includes(bytes.toString('base64')),false);
 const p=store.get('film-project','portrait-project');p.reference.sha256='bad';store.put('film-project',p);await assert.rejects(director.submit({...input,requestId:'broken-image'}),/REFERENCE_INVALID/);assert.equal(calls,1);
});

test('terminal text status is released only after persistence settles, avoiding a false busy failure on automatic planning',async t=>{
 const {store,cleanup}=await fixture(t);let release;const audit=store.audit.bind(store),hold=new Promise(r=>release=r);t.after(()=>release());
 store.audit=async(action,subject)=>{if(action==='openai_text_completed')await hold;return audit(action,subject);};let calls=0;
 const director=new OpenAIDirector(store,{fetcher:async()=>{calls++;return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'نتفق على عشرين ثانية',proposed_duration_seconds:20,style:'realistic',ready_to_write:false,missing:[],portrait_prompt:null,continuity_notes:''})}]}]});}});cleanup.push(()=>{release();return director.close();});
 const input={requestId:'settled-call',projectId:'settled-project',mode:'discuss',approvedTextCost:true,messages:[{role:'user',content:'عشرين ثانية'}]};await director.submit(input);
 for(let n=0;n<100&&store.get('text-call',input.requestId).status!=='completed';n++)await new Promise(r=>setTimeout(r,5));
 assert.equal(store.get('text-call',input.requestId).status,'completed');assert.equal((await director.get(input.requestId)).status,'running');assert.equal((await director.submit(input)).status,'running');assert.equal(calls,1);
 release();await finish(director);assert.equal((await director.get(input.requestId)).status,'completed');
});
