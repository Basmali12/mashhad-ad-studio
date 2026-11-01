import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {createEngineAPI} from '../engine/api.mjs';
import {Store} from '../engine/store.mjs';
import {quality,settings,modelConfigured} from '../engine/config.mjs';

// Strict isolated provider boundary. No SDK, network, GPU, model or paid API.
class IsolatedProvider {
  calls=[]; sessions=new Map();
  async call(action,input){
    this.calls.push({action,input});
    if(action==='discover')return {ready:true,files:[]};
    if(action==='stop'||action==='inspect')return {cloud_stopped:true,running_containers:0,tasks:0};
    throw Error('UNEXPECTED_PROVIDER_CALL');
  }
  session(input,event){
    this.calls.push({action:'session',input});
    let resolve;const done=new Promise(r=>resolve=r);
    const stop=()=>resolve({cloud_stopped:true,running_containers:0,tasks:0});
    this.sessions.set(input.jobId,{stop,input});
    setImmediate(()=>event({kind:'ready',phase:'ready',ready_until:Date.now()+60000}));
    return {done,stop,generate:async()=>({videoVerified:true,cloud_stopped:false})};
  }
}
async function fixture(t,{paid=true,rentals=true}={}){
  const folder=await mkdtemp(path.join(tmpdir(),'film-foundation-')),key=randomBytes(32).toString('base64');
  const store=new Store(folder,key);store.installRentalSchema();
  const account={id:randomUUID(),mode:'local_profile',workspace:'fixture-only',volume:'fixture-only',activated:true};store.put('account',account);
  const provider=new IsolatedProvider();
  const api=await createEngineAPI({folder,key,store,provider,allowPaid:paid,allowCustomerRentals:rentals,origin:'https://fixture.test',textQuality:{available(){throw Error('UNCONFIGURED_MUST_NOT_REQUIRE_TEXT_MODELS');},process(){throw Error('UNCONFIGURED_MUST_NOT_REQUIRE_TEXT_MODELS');}}});
  const a={tenantId:'tenant-a',rentalId:randomUUID(),engineSlotId:'slot-a',accountId:account.id};
  const b={tenantId:'tenant-b',rentalId:randomUUID(),engineSlotId:'slot-b',accountId:account.id};
  t.after(async()=>{for(const s of provider.sessions.values())s.stop();await api.close();await rm(folder,{recursive:true,force:true});});
  const quote=(scope=a,extra={})=>api.invoke('quote',{accountId:account.id,action:'start',settings:{},...extra},scope);
  const execute=(q,scope=a)=>api.invoke('execute',{quoteId:q.id,approvedCost:true},scope);
  return {api,store,provider,account,a,b,quote,execute,folder,key};
}
async function ready(f,id){for(let n=0;n<100;n++){const j=f.store.get('job',id);if(j?.status==='ready')return j;await new Promise(r=>setTimeout(r,5));}throw Error('FIXTURE_READY_TIMEOUT');}

test('broken output storage blocks a quote before any provider call',async t=>{
 const f=await fixture(t);await writeFile(path.join(f.folder,'artifacts'),'not-a-directory');
 await assert.rejects(f.quote(),/LOCAL_ARTIFACT_NOT_WRITABLE/);assert.equal(f.provider.calls.length,0);
});
test('storage becoming unwritable after quote fails before GPU dispatch and records zero estimated compute',async t=>{
 const f=await fixture(t),q=await f.quote();const artifacts=path.resolve(f.folder,'artifacts');
 assert.equal(path.dirname(artifacts),path.resolve(f.folder));await rm(artifacts,{recursive:true,force:true});await writeFile(artifacts,'not-a-directory');
 const accepted=await f.execute(q);let job;
 for(let n=0;n<100;n++){job=f.store.get('job',accepted.id);if(job?.status==='failed')break;await new Promise(r=>setTimeout(r,5));}
 assert.equal(job.status,'failed');assert.equal(job.error,'LOCAL_ARTIFACT_NOT_WRITABLE');assert.equal(job.cloudStopped,true);assert.equal(job.estimatedUSD,0);
 assert.equal(f.provider.calls.some(c=>['session','generate','stop'].includes(c.action)),false);
});

test('unconfigured model cannot select a retired fallback but preserves generic GPU settings',()=>{
 assert.equal(modelConfigured,false);assert.equal(quality.profile,'unconfigured');assert.equal(quality.contract,'unconfigured');
 assert.equal(quality.nativeAudio,false);assert.equal(quality.pipeline,null);assert.equal(quality.videoDecoder,null);
 assert.deepEqual([settings().gpu,settings().cpu,settings().ram],['RTX-PRO-6000',4,96]);
});

test('two tenants on different slots share one account but run separate simultaneous sessions',async t=>{
  const f=await fixture(t);const qa=await f.quote(f.a),qb=await f.quote(f.b);
  const [ja,jb]=await Promise.all([f.execute(qa,f.a),f.execute(qb,f.b)]);
  await Promise.all([ready(f,ja.id),ready(f,jb.id)]);
  assert.notEqual(ja.id,jb.id);assert.equal(f.provider.sessions.size,2);
  assert.equal(f.store.get('job',ja.id).tenantId,f.a.tenantId);assert.equal(f.store.get('job',jb.id).engineSlotId,'slot-b');
  assert.equal(f.provider.calls.some(c=>c.action==='quality_discover'),false);
});
test('same slot rejects concurrent starts and legacy administrator excludes all active rentals',async t=>{
  const f=await fixture(t);const q1=await f.quote(),q2=await f.quote();
  const results=await Promise.allSettled([f.execute(q1),f.execute(q2)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.match(results.find(r=>r.status==='rejected').reason.message,/ONE_ACTIVE_OR_UNCERTAIN_JOB_ONLY/);
  await ready(f,results.find(r=>r.status==='fulfilled').value.id);
  const adminQuote=await f.api.invoke('quote',{action:'start',accountId:f.account.id,settings:{}});
  await assert.rejects(f.api.invoke('execute',{quoteId:adminQuote.id,approvedCost:true}),/ONE_ACTIVE_OR_UNCERTAIN_JOB_ONLY/);
  assert.equal(f.provider.sessions.size,1);
});
test('a legacy uncertain session globally excludes new rental starts',async t=>{
  const f=await fixture(t);f.store.put('job',{id:randomUUID(),action:'start',status:'uncertain',cloudStopped:false,estimate:{rate:0,resourceWindowUSD:0},createdAt:Date.now()});
  const q=await f.quote();await assert.rejects(f.execute(q),/ONE_ACTIVE_OR_UNCERTAIN_JOB_ONLY/);assert.equal(f.provider.sessions.size,0);
});
test('quotes, jobs, warm sessions, retries and administrative account routes deny foreign tenant context',async t=>{
  const f=await fixture(t);const q=await f.quote();
  await assert.rejects(f.execute(q,f.b),/RENTAL_SCOPE_DENIED/);
  const job=await f.execute(q);await ready(f,job.id);
  await assert.rejects(f.api.invoke('jobs/'+job.id,undefined,f.b),/RENTAL_SCOPE_DENIED/);
  await assert.rejects(f.api.invoke('jobs/'+job.id+'/stop',{confirmCancel:true},f.b),/RENTAL_SCOPE_DENIED/);
  await assert.rejects(f.quote(f.b,{action:'generate',engineJobId:job.id,projectId:'p',sceneId:'s',prompt:'Arabic dialogue scene',audioContract:{lines:[{speaker:'علي',text:'شلونك اليوم؟'}]}}),/RENTAL_SCOPE_DENIED/);
  await assert.rejects(f.api.invoke('accounts',undefined,f.a),/RENTAL_SCOPE_DENIED/);
  assert.equal(f.provider.sessions.size,1);
});
test('HTTP spoofed rental/admin headers never obtain an internal capability',async t=>{
  const f=await fixture(t);const req=Readable.from([]);Object.assign(req,{url:'/api/engine/accounts',method:'GET',socket:{encrypted:true,remoteAddress:'127.0.0.1'},headers:{origin:'https://fixture.test','x-internal-scope':'admin','x-tenant-id':'tenant-a','x-admin':'true','x-film-admin':'true'}});
  let status;let output='';const res={setHeader(){},writeHead(s){status=s;},end(x=''){output+=x;}};
  await f.api.handler(req,res);assert.equal(status,401);assert.equal(JSON.parse(output).error,'ADMIN_LOGIN_REQUIRED');
});
test('slow discovery on slot B does not serialize emergency stop on slot A',async t=>{
  const f=await fixture(t);const job=await f.execute(await f.quote());await ready(f,job.id);
  const original=f.provider.call.bind(f.provider);let release,entered;
  const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  f.provider.call=async(action,input)=>{if(action==='discover'){entered();await gate;}return original(action,input);};
  const slow=f.quote(f.b);await started;
  try{await Promise.race([f.api.invoke('jobs/'+job.id+'/stop',{confirmCancel:true},f.a),new Promise((_,reject)=>setTimeout(()=>reject(Error('STOP_BLOCKED_BY_OTHER_SLOT')),500))]);}finally{release();await slow;}
});
test('restart preserves uncertain state and marks ready state recovery required without dispatch',async t=>{
  const folder=await mkdtemp(path.join(tmpdir(),'film-restart-')),key=randomBytes(32).toString('base64'),provider=new IsolatedProvider();
  let store=new Store(folder,key);store.installRentalSchema();const uncertain=randomUUID(),warm=randomUUID();
  store.put('job',{id:uncertain,action:'start',engineSlotId:'old-a',tenantId:'tenant-a',status:'uncertain',cloudStopped:false});
  store.put('job',{id:warm,action:'start',engineSlotId:'old-b',tenantId:'tenant-b',status:'ready',cloudStopped:false});store.close();
  store=new Store(folder,key);
  const api=await createEngineAPI({folder,key,store,provider,allowPaid:false,allowCustomerRentals:true});
  try{assert.equal(store.get('job',uncertain).status,'uncertain');assert.equal(store.get('job',warm).status,'recovery_required');assert.equal(store.rentalsReady(),true);assert.equal(provider.calls.length,0);}finally{await api.close();await rm(folder,{recursive:true,force:true});}
});
test('customer rentals require migration and remain disabled unless explicitly enabled',async t=>{
  const f=await fixture(t,{rentals:false});await assert.rejects(f.quote(),/CUSTOMER_PLATFORM_DISABLED/);
});
test('rental schema readiness fails before modifying an unmigrated store',async t=>{
  const folder=await mkdtemp(path.join(tmpdir(),'film-unmigrated-')),key=randomBytes(32).toString('base64'),store=new Store(folder,key);
  try{await assert.rejects(createEngineAPI({folder,key,store,allowCustomerRentals:true,provider:new IsolatedProvider()}),/RENTAL_MIGRATION_002_REQUIRED/);assert.equal(store.all('config').length,0);}finally{store.close();await rm(folder,{recursive:true,force:true});}
});
test('paid actions default to disabled and quotes never dispatch sessions',async t=>{
  const f=await fixture(t,{paid:false});const q=await f.quote();assert.equal(q.paidEnabled,false);
  await assert.rejects(f.execute(q),/PAID_ACTIONS_DISABLED_ON_SERVER/);assert.equal(f.provider.sessions.size,0);
});
