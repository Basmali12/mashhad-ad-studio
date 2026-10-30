import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {Readable,Writable} from 'node:stream';
import {once} from 'node:events';
import {Store} from '../engine/store.mjs';
import {createAdminCommissioning} from '../engine/admin-commissioning.mjs';

async function fixture(t){
 const folder=await mkdtemp(path.join(tmpdir(),'admin-commission-')),store=new Store(folder,randomBytes(32).toString('base64'));
 const account={id:randomUUID(),activated:true,discovery:{ready:true}},slot={id:randomUUID(),accountId:account.id,revision:1,gpu:'RTX-PRO-6000',published:false,locked:true,hourMicros:3000000},quoteId=randomUUID();
 const bytes=Buffer.from('OFFLINE-ARTIFACT-FIXTURE-NOT-GENERATED-VIDEO');
 const job={id:randomUUID(),quoteId,accountId:account.id,action:'generate',createdAt:Date.now(),status:'completed',cloudStopped:true,settings:{gpu:slot.gpu},quality:{contract:'fixed-quality'},prompt:'PRIVATE_PROMPT',result:{videoVerified:true,sha256:createHash('sha256').update(bytes).digest('hex'),textQuality:{status:'passed'}}};
 for(const [kind,row] of [['account',account],['film-slot',slot],['film-admin-test',{id:quoteId,slotId:slot.id,revision:1}],['job',job]])store.put(kind,row);
 const file=path.join(folder,'artifacts',job.id,'video.mp4');await mkdir(path.dirname(file),{recursive:true});await writeFile(file,bytes);
 let time=Date.now(),invocations=0;const engine={quality:{contract:'fixed-quality',textQualityRequired:true},invoke(){invocations++;throw Error('PAID_WORK_FORBIDDEN');}};
 const core=createAdminCommissioning({store,engine,origin:'https://fixture.test',secret:'fixture-private-signature-0123456789',now:()=>time,mediaOrigins:['https://front.test']});
 const dispatch=(op,input)=>core.dispatch({isAdmin:true},op,input,'admin');
 t.after(async()=>{await store.close();await rm(folder,{recursive:true,force:true});});
 return {store,core,dispatch,slot,account,job,file,bytes,advance:n=>time+=n,invocations:()=>invocations};
}
async function media(f,url,{headers={},method='GET'}={}){
 const req=Readable.from([]);Object.assign(req,{method,headers});let status;const chunks=[],values={};
 const res=new Writable({write(c,_e,cb){chunks.push(c);cb();}});res.setHeader=(k,v)=>{values[k]=v;};res.writeHead=(s,h)=>{status=s;Object.assign(values,h);};const done=once(res,'finish');
 assert.equal(await f.core.handle(req,res,new URL(url),true),true);await done;return {status,headers:values,bytes:Buffer.concat(chunks)};
}
test('admin test recovery is a scoped metadata read without paid calls or prompt leakage',async t=>{
 const f=await fixture(t),view=await f.dispatch('admin.test.status',{id:f.slot.id});assert.equal(view.id,f.job.id);assert.equal(view.ready,true);assert.equal(JSON.stringify(view).includes('PRIVATE_PROMPT'),false);assert.equal(f.invocations(),0);
 await assert.rejects(f.core.dispatch({isAdmin:false},'admin.test.status',{id:f.slot.id},'customer'),/FORBIDDEN/);
});
test('unresolved submitted test survives reload and blocks reporting an older result as ready',async t=>{
 const f=await fixture(t);f.store.put('film-admin-test',{id:randomUUID(),slotId:f.slot.id,revision:1,submittedAt:f.job.createdAt+50});const view=await f.dispatch('admin.test.status',{id:f.slot.id});assert.equal(view.status,'uncertain');assert.equal(view.ready,false);assert.equal(view.id,undefined);
});
test('preview and download are separate signed tickets with real range support',async t=>{
 const f=await fixture(t),preview=await f.dispatch('admin.test.ticket',{id:f.slot.id,jobId:f.job.id}),response=await media(f,preview.url,{headers:{range:'bytes=2-7',origin:'https://front.test'}});
 assert.equal(response.status,206);assert.deepEqual(response.bytes,f.bytes.subarray(2,8));assert.equal(response.headers['Content-Type'],'video/mp4');assert.equal(response.headers['Content-Disposition'],undefined);
 const download=await f.dispatch('admin.test.ticket',{id:f.slot.id,jobId:f.job.id,download:true});const result=await media(f,download.url,{method:'HEAD'});assert.match(result.headers['Content-Disposition'],/attachment/);assert.equal(result.bytes.length,0);assert.equal(f.invocations(),0);
});
test('tickets reject expiry, foreign origins and mutated test bytes without regenerating',async t=>{
 const f=await fixture(t),ticket=await f.dispatch('admin.test.ticket',{id:f.slot.id,jobId:f.job.id});assert.equal((await media(f,ticket.url,{headers:{origin:'https://evil.test'}})).status,403);
 await writeFile(f.file,'CHANGED');assert.equal((await media(f,ticket.url)).status,404);await assert.rejects(f.dispatch('admin.test.publish',{id:f.slot.id,jobId:f.job.id,reviewed:true}),/MP4_NOT_VERIFIED/);
 f.advance(180001);assert.equal((await media(f,ticket.url)).status,403);assert.equal(f.invocations(),0);
});
test('another account, customer job or stale slot revision cannot certify or preview this engine',async t=>{
 const f=await fixture(t);for(const patch of [{accountId:randomUUID()},{tenantId:'customer'},{settings:{gpu:'L40S'}}]){f.store.put('job',{...f.job,...patch});await assert.rejects(f.dispatch('admin.test.ticket',{id:f.slot.id,jobId:f.job.id}),/REAL_GPU_TEST_REQUIRED/);}
 f.store.put('job',f.job);f.store.put('film-slot',{...f.slot,revision:2});await assert.rejects(f.dispatch('admin.test.publish',{id:f.slot.id,jobId:f.job.id,reviewed:true}),/REAL_GPU_TEST_REQUIRED/);
});
test('publishing requires real test, manual review, ready account, quality approval and stopped resources',async t=>{
 const f=await fixture(t),input={id:f.slot.id,jobId:f.job.id,reviewed:true};await assert.rejects(f.dispatch('admin.test.publish',{...input,reviewed:false}),/APPROVAL_REQUIRED/);
 f.store.put('job',{...f.job,cloudStopped:false});await assert.rejects(f.dispatch('admin.test.publish',input),/REAL_GPU_TEST_REQUIRED/);
 f.store.put('job',{...f.job,result:{...f.job.result,textQuality:{status:'needs_review'}}});await assert.rejects(f.dispatch('admin.test.publish',input),/REAL_GPU_TEST_REQUIRED/);
 f.store.put('job',f.job);f.store.put('account',{...f.account,discovery:{ready:false}});await assert.rejects(f.dispatch('admin.test.publish',input),/REAL_GPU_TEST_REQUIRED/);
 assert.equal(f.store.get('film-slot',f.slot.id).published,false);assert.equal(f.invocations(),0);
});
test('one atomic publish opens only the tested engine and starts no GPU',async t=>{
 const f=await fixture(t),input={id:f.slot.id,jobId:f.job.id,reviewed:true};f.store.put('job',{id:randomUUID(),accountId:f.account.id,action:'start',status:'ready',cloudStopped:false});await assert.rejects(f.dispatch('admin.test.publish',input),/ACCOUNT_IN_USE/);
 for(const row of f.store.all('job'))if(row.id!==f.job.id)f.store.put('job',{...row,cloudStopped:true});await f.dispatch('admin.test.publish',input);
 const slot=f.store.get('film-slot',f.slot.id);assert.equal(slot.published,true);assert.equal(slot.locked,false);assert.equal(slot.testJobId,f.job.id);assert.equal(slot.hourMicros,3000000);assert.equal(slot.testingOnly,false);assert.equal(f.invocations(),0);
});
