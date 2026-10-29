import './conv-fixture-profile.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {Readable} from 'node:stream';
import {deflateSync,crc32} from 'node:zlib';
import {inspectReference,REFERENCE_LIMIT} from '../engine/film-reference.mjs';
import {Store,hash} from '../engine/store.mjs';
import {createEngineAPI} from '../engine/api.mjs';
import {createFilmPlatform} from '../engine/film-platform.mjs';
import {signBridge,verifyBridge} from '../engine/film-bridge-security.mjs';
import {money,cost,minimumCredit,CREDIT_LIFETIME} from '../engine/film-money.mjs';
import {createFilmService} from '../service.mjs';
class Provider{
 calls=[];sessions=new Map();uncertain=false;
 async call(action,input){this.calls.push({action,input});if(action==='discover')return {ready:true,files:[]};if(['stop','inspect','cloud_transfer_stop','cloud_transfer_status'].includes(action))return this.uncertain?{cloud_stopped:false,running_containers:null,tasks:null}:{cloud_stopped:true,running_containers:0,tasks:0};throw Error('UNEXPECTED_NETWORK_BOUNDARY');}
 session(input,event){this.calls.push({action:'session',input});let resolve;const done=new Promise(r=>resolve=r);const stop=()=>resolve(this.uncertain?{cloud_stopped:false}:{cloud_stopped:true,running_containers:0,tasks:0});this.sessions.set(input.jobId,{stop});setImmediate(()=>event({kind:'ready',phase:'ready'}));return {done,stop,generate:async()=>{throw Error('GPU_GENERATION_FORBIDDEN_IN_LOCAL_TEST');}};}
}
const admin={id:'admin',name:'Admin',email:'admin@fixture.test',isAdmin:true},alice={id:'alice',name:'Alice',email:'alice@fixture.test'},bob={id:'bob',name:'Bob',email:'bob@fixture.test'};
async function fixture(t,{enabled=true,paid=true,text=false,referenceCustomerByteLimit=67108864}={}){
 const folder=await mkdtemp(path.join(tmpdir(),'film-platform-')),key=randomBytes(32).toString('base64'),store=new Store(folder,key);store.installRentalSchema();
 const provider=new Provider(),account={id:randomUUID(),mode:'local_profile',workspace:'private-workspace',volume:'private-volume',activated:true,discovery:{ready:true,checkedAt:Date.now()}};store.put('account',account);
 const engine=await createEngineAPI({folder,key,store,provider,allowPaid:paid,allowCustomerRentals:enabled,origin:'https://fixture.test'});
 let time=Date.now();const secret='test-only-bridge-secret-012345678901234567890';const platform=createFilmPlatform({engine,origin:'https://fixture.test',secret,enabled,referenceCustomerByteLimit,now:()=>time,startWorker:false,textEnabled:text,textBudgetMicroUSD:text?2000000:0,mediaOrigins:['https://front.test'],closeTimeoutMs:30});
 const invoke=(actor,op,input={})=>platform.dispatch(actor,op,input);
 const users={};for(const a of [alice,bob])users[a.id]=(await invoke(a,'session')).user.id;
 const slot=await invoke(admin,'admin.slot.save',{accountId:account.id,name:'GPU fixture',hourPriceUSD:'3.60'});
 // Fixture publication bypass is explicit and local; production publish gate is independently tested below.
 store.put('film-slot',{...slot,published:true,locked:false});
 await invoke(admin,'admin.capacity.save',{accountId:account.id,maxConcurrent:2});
 const credit=(a,amount='10',requestId=randomUUID())=>invoke(admin,'admin.credit.add',{customerId:users[a.id],amountUSD:amount,requestId});
 const start=async(a,requestId=randomUUID())=>{const q=await invoke(a,'rental.quote',{serverId:slot.id});return invoke(a,'rental.start',{serverId:slot.id,priceMicroUSD:q.priceMicroUSD,revision:q.revision,approved:true,requestId});};
 t.after(async()=>{for(const c of provider.sessions.values())c.stop();await platform.close();await engine.close();await rm(folder,{recursive:true,force:true});});
 return {folder,store,provider,engine,platform,invoke,users,slot,account,credit,start,secret,now:()=>time,advance:n=>time+=n};
}
async function waitFor(check){for(let i=0;i<100;i++){const value=await check();if(value)return value;await new Promise(r=>setTimeout(r,5));}throw Error('FIXTURE_TIMEOUT');}
async function warm(f,r){await waitFor(()=>f.store.get('rental',r.id)?.engineJobId);await waitFor(()=>f.store.get('job',f.store.get('rental',r.id).engineJobId)?.status==='ready');await f.platform.tick();return f.store.get('rental',r.id);}
async function bridge(f,{actor=alice,operation='wallet',input={},requestId=randomUUID(),nonce=randomUUID(),secure=true,headers={},raw}={}){
 const body=raw??JSON.stringify({requestId,actor,operation,input}),time=String(f.now());const req=Readable.from([Buffer.from(body)]);Object.assign(req,{url:'/api/film-bridge',method:'POST',socket:{encrypted:secure,remoteAddress:'203.0.113.8'},headers:{'x-film-time':time,'x-film-nonce':nonce,'x-film-signature':signBridge(f.secret,time,nonce,body),...headers}});let status,output='';const res={setHeader(){},writeHead(s){status=s;},end(b=''){output+=b;}};await f.platform.handler(req,res);return {status,body:JSON.parse(output)};
}
test('exact integer money, cumulative rounding, zero metadata, 30 day expiry',()=>{
 assert.equal(money('0.000001'),1);assert.equal(money('0',{allowZero:true}),0);assert.throws(()=>money('0'));assert.throws(()=>money('1e2'));assert.throws(()=>money('0.0000001'));
 assert.equal(cost(1,1),1);assert.equal(cost(3600000,1234),1234);assert.equal(minimumCredit(3600000),240000);assert.equal(CREDIT_LIFETIME,2592000000);
});
test('loading and slot save do not call supplier, require admin, default locks and reject malicious tenant',async t=>{
 const f=await fixture(t);assert.equal(f.provider.calls.length,0);await assert.rejects(f.invoke(alice,'admin.capacity.save',{}),/FORBIDDEN/);
 const slot=await f.invoke(admin,'admin.slot.save',{accountId:f.account.id,name:'Second',hourPriceUSD:'1'});assert.equal(slot.locked,true);assert.equal(slot.published,false);assert.equal(f.provider.calls.length,0);
 await assert.rejects(f.invoke({...alice,id:'../admin'},'wallet'),/UNAUTHORIZED/);await assert.rejects(f.invoke(alice,{},{}),/INVALID_INPUT/);
 assert.equal((await f.invoke(admin,'admin.billing.save',{accountId:f.account.id,remainingUSD:'0'})).remainingMicroUSD,0);
});
test('topups are immutable/idempotent and credit lots expire without rollover',async t=>{
 const f=await fixture(t);await Promise.all([f.credit(alice,'1.234567','topup'),f.credit(alice,'1.234567','topup')]);assert.equal(f.store.all('film-ledger').length,1);assert.equal((await f.invoke(alice,'wallet')).balanceMicroUSD,1234567);
 await assert.rejects(f.credit(bob,'1.234567','topup'),/IDEMPOTENCY_CONFLICT/);f.advance(CREDIT_LIFETIME);const w=await f.invoke(alice,'wallet');assert.equal(w.balanceMicroUSD,0);assert.equal(w.expiresAt,null);assert.equal(f.store.all('film-ledger').length,1);assert.equal(f.store.all('film-credit').length,1);
});
test('double-click start is one durable session, same slot competes atomically and tenant privacy',async t=>{
 const f=await fixture(t);await f.credit(alice);await f.credit(bob);const [a,b]=await Promise.all([f.start(alice,'same'),f.start(alice,'same')]);assert.equal(a.id,b.id);await warm(f,a);assert.equal(f.provider.sessions.size,1);
 await assert.rejects(f.start(bob),/SERVER_BUSY/);await assert.rejects(f.invoke(bob,'rental.status',{id:a.id}),/NOT_FOUND/);assert.equal(JSON.stringify(await f.invoke(alice,'rental.status',{id:a.id})).includes('private-workspace'),false);
});
test('two slots share declared account capacity and price stays frozen on active rental',async t=>{
 const f=await fixture(t);await f.credit(alice);await f.credit(bob);const second=await f.invoke(admin,'admin.slot.save',{accountId:f.account.id,name:'second',hourPriceUSD:'5'});f.store.put('film-slot',{...second,published:true,locked:false});
 const a=await f.start(alice);await warm(f,a);const q=await f.invoke(bob,'rental.quote',{serverId:second.id});const b=await f.invoke(bob,'rental.start',{...q,serverId:second.id,approved:true,requestId:'bob-start'});await warm(f,b);assert.equal(f.provider.sessions.size,2);
 await f.invoke(admin,'admin.slot.save',{id:f.slot.id,accountId:f.account.id,name:'changed',hourPriceUSD:'7'});assert.equal((await f.invoke(alice,'rental.status',{id:a.id})).hourPriceUSD,3.6);
 await f.invoke(admin,'admin.slot.lock',{id:f.slot.id,locked:true});assert.equal(f.store.get('rental',a.id).state,'ready');
});
test('stale quotes, minimum guard funds, disabled paid execution and active user reject safely',async t=>{
 const f=await fixture(t);await f.credit(alice,'0.01');await assert.rejects(f.start(alice),/INSUFFICIENT_CREDIT/);await f.credit(alice);
 const q=await f.invoke(alice,'rental.quote',{serverId:f.slot.id});await f.invoke(admin,'admin.slot.save',{id:f.slot.id,accountId:f.account.id,name:'price',hourPriceUSD:'4'});
 await assert.rejects(f.invoke(alice,'rental.start',{...q,approved:true,requestId:'stale'}),/COST_CHANGED/);assert.equal(f.provider.calls.length,0);
 const off=await fixture(t,{enabled:false,paid:false});await off.credit(alice);await assert.rejects(off.start(alice),/PAID_DISABLED/);assert.equal(off.provider.calls.length,0);
});
test('meter cumulative pennies once, expires during activity and records uncovered supplier liability',async t=>{
 const f=await fixture(t);await f.credit(alice,'1');const r=await warm(f,await f.start(alice));let job=f.store.get('job',r.engineJobId);job.events=[{phase:'runtime_imports',receivedAt:f.now()}];f.store.put('job',job);f.store.put('rental',{...f.store.get('rental',r.id),meterStartedAt:f.now(),lastMeterAt:f.now(),meteredMicroUSD:0,chargedMicroUSD:0});
 await f.platform.tick();f.advance(1000);await f.platform.tick();await f.platform.tick();assert.equal(f.store.get('rental',r.id).chargedMicroUSD,1000);
 const lot=f.store.all('film-credit')[0];lot.expiresAt=f.now()+1000;f.store.put('film-credit',lot);let current=f.store.get('rental',r.id);current.creditExpiresAt=lot.expiresAt;f.store.put('rental',current);
 f.provider.uncertain=true;f.advance(3000);await f.platform.tick();current=f.store.get('rental',r.id);assert.equal(current.chargedMicroUSD,2000);assert.equal(current.uncoveredMicroUSD,2000);assert.notEqual(current.state,'closed');assert.ok(f.store.all('film-credit')[0].remaining>=0);
});
test('low funds requests stop, resource uncertainty never releases a lease',async t=>{
 const f=await fixture(t);await f.credit(alice,'0.25');const r=await warm(f,await f.start(alice)),job=f.store.get('job',r.engineJobId);job.events=[{phase:'runtime_imports',receivedAt:f.now()}];f.store.put('job',job);await f.platform.tick();f.provider.uncertain=true;f.advance(200000);await f.platform.tick();assert.equal(f.store.get('rental',r.id).stopReason,'LOW_FUNDS');assert.notEqual(f.store.get('rental',r.id).state,'closed');await assert.rejects(f.start(alice),/USER_HAS_RENTAL|SERVER_BUSY/);
});
test('publish requires fresh same account GPU quality proof and explicit visual/audio review',async t=>{
 const f=await fixture(t);await assert.rejects(f.invoke(admin,'admin.slot.publish',{id:f.slot.id}),/REAL_GPU_TEST_REQUIRED/);
 const j={id:randomUUID(),accountId:f.account.id,settings:{gpu:'RTX-PRO-6000'},status:'completed',cloudStopped:true,quality:f.engine.quality,result:{videoVerified:true}};f.store.put('job',j);
 await assert.rejects(f.invoke(admin,'admin.slot.verify',{id:f.slot.id,jobId:j.id}),/REAL_GPU_TEST_REQUIRED/);await f.invoke(admin,'admin.slot.verify',{id:f.slot.id,jobId:j.id,reviewed:true});await f.invoke(admin,'admin.slot.publish',{id:f.slot.id});j.quality={contract:'stale'};f.store.put('job',j);await assert.rejects(f.invoke(admin,'admin.slot.publish',{id:f.slot.id}),/REAL_GPU_TEST_REQUIRED/);
});

test('administrator can explicitly publish a trial without inventing quality proof or starting GPU',async t=>{
 const f=await fixture(t);f.store.put('film-slot',{...f.slot,published:false,locked:true});
 await assert.rejects(f.invoke(alice,'admin.slot.publish',{id:f.slot.id,testingOnly:true,approved:true}),/FORBIDDEN/);
 await assert.rejects(f.invoke(admin,'admin.slot.publish',{id:f.slot.id,testingOnly:true}),/APPROVAL_REQUIRED/);
 const before=f.provider.calls.length;
 await f.invoke(admin,'admin.slot.publish',{id:f.slot.id,testingOnly:true,approved:true});
 const slot=f.store.get('film-slot',f.slot.id);assert.equal(slot.published,true);assert.equal(slot.testingOnly,true);assert.equal(slot.locked,true);assert.equal(slot.testJobId,undefined);
 assert.equal(f.provider.calls.length,before);assert.equal(f.store.all('job').length,0);
 const listed=(await f.invoke(alice,'servers.list'))[0];assert.match(listed.availability,/للتجربة/);assert.equal(listed.state,'locked');
 await assert.rejects(f.invoke(admin,'admin.slot.publish',{id:f.slot.id}),/REAL_GPU_TEST_REQUIRED/);
 f.store.put('account',{...f.account,activated:false});await assert.rejects(f.invoke(admin,'admin.slot.publish',{id:f.slot.id,testingOnly:true,approved:true}),/WEIGHTS_NOT_READY/);
 f.store.put('account',{...f.account,discovery:{ready:false}});await assert.rejects(f.invoke(admin,'admin.slot.publish',{id:f.slot.id,testingOnly:true,approved:true}),/WEIGHTS_NOT_READY/);
 f.store.put('account',f.account);f.store.put('job',{id:'active-work',accountId:f.account.id,action:'start',cloudStopped:false});await assert.rejects(f.invoke(admin,'admin.slot.publish',{id:f.slot.id,testingOnly:true,approved:true}),/ACCOUNT_IN_USE/);
});

test('both catalog entries show busy when their shared account capacity is occupied',async t=>{
 const f=await fixture(t);await f.invoke(admin,'admin.capacity.save',{accountId:f.account.id,maxConcurrent:1});
 const other=await f.invoke(admin,'admin.slot.save',{accountId:f.account.id,name:'Second',hourPriceUSD:'3'});f.store.put('film-slot',{...other,published:true,locked:false});
 await f.credit(alice);await warm(f,await f.start(alice));assert.ok((await f.invoke(bob,'servers.list')).every(s=>s.state==='busy'));
});
test('HMAC time/body/HTTPS/replay checks and polling avoids durable request cache',async t=>{
 const f=await fixture(t);const nonce=randomUUID(),requestId=randomUUID();assert.equal((await bridge(f,{nonce,requestId})).status,200);assert.equal((await bridge(f,{nonce,requestId})).body.error,'BRIDGE_UNAUTHORIZED');assert.equal((await bridge(f,{secure:false})).body.error,'BRIDGE_UNAUTHORIZED');assert.equal((await bridge(f,{headers:{'x-film-signature':'0'.repeat(64)}})).body.error,'BRIDGE_UNAUTHORIZED');
 assert.equal(f.store.all('film-bridge-request').length,0);f.advance(121000);await bridge(f);assert.equal(f.store.all('film-bridge-nonce').length,1);
 assert.throws(()=>verifyBridge(f.secret,{'x-film-time':String(f.now()-61000),'x-film-nonce':randomUUID(),'x-film-signature':'0'.repeat(64)},'',f.now()),/UNAUTHORIZED/);
});
test('durable mutation replay with fresh nonce returns original result without repeating topup',async t=>{
 const f=await fixture(t);const args={actor:admin,operation:'admin.credit.add',input:{customerId:f.users.alice,amountUSD:'1',requestId:'credit-http'},requestId:'bridge-credit'};assert.equal((await bridge(f,args)).status,200);assert.equal((await bridge(f,args)).status,200);assert.equal(f.store.all('film-ledger').length,1);assert.equal((await bridge(f,{...args,input:{...args.input,amountUSD:'2'}})).body.error,'BRIDGE_UNAUTHORIZED');
});
test('multiline stories persist, project privacy and media tickets hide engine job identifiers',async t=>{
 const f=await fixture(t);const p=await f.invoke(alice,'project.save',{name:'story',story:'A story\nsecond line',seconds:300,orientation:'portrait'});await assert.rejects(f.invoke(bob,'project.get',{id:p.id}),/NOT_FOUND/);
 const project=f.store.get('film-project',p.id),jid=randomUUID();project.rentalId='rental-fixture';project.scenes=[{jobId:jid,status:'done'}];f.store.put('film-project',project);f.store.put('job',{id:jid,tenantId:f.users.bob,projectId:p.id,rentalId:project.rentalId,result:{videoVerified:true}});
 await assert.rejects(f.invoke(alice,'media.ticket',{projectId:p.id,index:0}),/NOT_FOUND/);f.store.put('job',{...f.store.get('job',jid),tenantId:f.users.alice});const ticket=await f.invoke(alice,'media.ticket',{projectId:p.id,index:0});assert.equal(ticket.url.includes(jid),false);assert.equal(ticket.expires,f.now()+180000);
});
test('customer responses redact supplier labels even when actor is admin',async t=>{
 const f=await fixture(t);f.store.put('film-slot',{...f.store.get('film-slot',f.slot.id),name:'Modal مودال'});const r=await bridge(f,{actor:admin,operation:'servers.list'});assert.equal(/modal|مودال/i.test(JSON.stringify(r.body)),false);
 f.engine.invoke=async()=>{throw Error('MODAL_TOKEN_SECRET_FAILURE');};const result=await bridge(f,{actor:admin,operation:'admin.account.inspect',input:{accountId:f.account.id}});assert.equal(result.body.error,'REQUEST_FAILED');
});
test('text submission claims atomically, remains visible pending and shutdown is bounded',async t=>{
 const f=await fixture(t,{text:true});const p=await f.invoke(alice,'project.save',{name:'story',story:'fiction',seconds:300,orientation:'portrait'});let calls=0;f.engine.invoke=async route=>{if(route==='llm/calls'){calls++;return {status:'queued'};}return {status:'running'};};
 const result=await Promise.allSettled([f.invoke(alice,'plan.submit',{projectId:p.id,approved:true}),f.invoke(alice,'plan.submit',{projectId:p.id,approved:true})]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal((await f.invoke(alice,'plan.status',{projectId:p.id})).textPending,true);await waitFor(()=>calls===1);const start=Date.now();await f.platform.close();assert.ok(Date.now()-start<500);
});
test('restart follow only adopts committed owned scene jobs and never calls paid execution',async t=>{
 const f=await fixture(t);const p=await f.invoke(alice,'project.save',{name:'story',story:'fiction',seconds:10,orientation:'portrait'});const project=f.store.get('film-project',p.id);project.state='generating';project.scenes=[{attempted:true,quoteId:'committed-quote',status:'submitted'}];f.store.put('film-project',project);f.store.put('job',{id:randomUUID(),quoteId:'committed-quote',tenantId:f.users.alice,projectId:p.id,status:'completed',cloudStopped:true,result:{videoVerified:true}});
 const followed=await f.invoke(alice,'project.follow',{id:p.id});assert.equal(followed.scenes[0].status,'done');assert.equal(followed.state,'completed');assert.equal(f.provider.calls.length,0);assert.equal('jobId' in followed.scenes[0],false);
});
test('standalone entry fails closed on implicit data, shared secret and missing explicit database',async()=>{
 await assert.rejects(createFilmService({env:{}}),/DEDICATED_FILM_DATA_REQUIRED/);
 await assert.rejects(createFilmService({env:{FILM_DATA_DIR:path.resolve('fixture'),FILM_DEDICATED_DATA_CONFIRMED:'YES'}}),/EXPLICIT_DATABASE_DRIVER_REQUIRED/);
});

test('atomic two-slot limit, account group lock and explicit stop guard',async t=>{
 const f=await fixture(t);const results=await Promise.allSettled([f.invoke(admin,'admin.slot.save',{accountId:f.account.id,name:'second',hourPriceUSD:'2'}),f.invoke(admin,'admin.slot.save',{accountId:f.account.id,name:'third',hourPriceUSD:'3'})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.store.all('film-slot').length,2);
 await f.invoke(admin,'admin.account.lock',{accountId:f.account.id,locked:true});assert.equal(f.store.all('film-slot').every(s=>s.locked),true);await assert.rejects(f.invoke(admin,'admin.account.stop',{accountId:f.account.id}),/APPROVAL_REQUIRED/);assert.equal(f.provider.calls.length,0);
});
test('safe explicit resume only submits remaining scene with backend owned last frame across rentals',async t=>{
 const f=await fixture(t);await f.credit(alice);const r=await warm(f,await f.start(alice)),priorRental='prior-rental',priorJob=randomUUID(),previousScene=randomUUID();
 f.store.put('rental',{id:priorRental,customerId:f.users.alice,state:'closed',engineJobId:priorJob});f.store.put('job',{id:priorJob,action:'start',status:'stopped',cloudStopped:true});
 const project=await f.invoke(alice,'project.save',{name:'resume',story:'fiction',seconds:20,orientation:'portrait'}),p=f.store.get('film-project',project.id);p.state='needs_review';p.rentalId=priorRental;p.scenes=[{attempted:true,status:'done',jobId:previousScene},{attempted:false,status:'pending',prompt:'A chronological scene',audioContract:{lines:[{speaker:'علي',text:'شلونك اليوم؟'}]}}];f.store.put('film-project',p);
 f.store.put('job',{id:previousScene,tenantId:f.users.alice,projectId:p.id,rentalId:priorRental,status:'completed',cloudStopped:true,result:{videoVerified:true}});
 await mkdir(path.join(f.folder,'artifacts',previousScene),{recursive:true});const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jUv0AAAAASUVORK5CYII=','base64');await writeFile(path.join(f.folder,'artifacts',previousScene,'last-frame.png'),png);
 const original=f.engine.invoke;let generated=0,captured;f.engine.invoke=async(route,b,scope,...rest)=>{if(route==='quote'&&b.action==='generate'){captured=b;return {id:'resume-quote'};}if(route==='execute'&&b.quoteId==='resume-quote'){generated++;const id=randomUUID();f.store.put('job',{id,quoteId:b.quoteId,tenantId:scope.tenantId,rentalId:scope.rentalId,projectId:p.id,status:'completed',cloudStopped:true,result:{videoVerified:true}});return {id};}return original(route,b,scope,...rest);};
 await f.invoke(alice,'project.resume',{projectId:p.id,rentalId:r.id,approved:true});await waitFor(()=>f.store.get('film-project',p.id).state==='completed');assert.equal(generated,1);assert.equal(captured.initialFrame,'data:image/png;base64,'+png.toString('base64'));assert.equal(captured.previousSceneId,undefined);assert.equal(f.store.get('film-project',p.id).scenes[0].jobId,previousScene);
 const ticket=await f.invoke(alice,'media.ticket',{projectId:p.id,index:0});assert.equal(ticket.url.includes(previousScene),false);
});
test('ambiguous attempted scenes block resume and never silently retry',async t=>{
 const f=await fixture(t);await f.credit(alice);const r=await warm(f,await f.start(alice));const p=await f.invoke(alice,'project.save',{name:'ambiguous',story:'fiction',seconds:20,orientation:'portrait'}),record=f.store.get('film-project',p.id);record.rentalId='old-rental';record.scenes=[{attempted:true,status:'submitted'},{attempted:false,status:'pending'}];f.store.put('film-project',record);f.store.put('rental',{id:'old-rental',customerId:f.users.alice,state:'closed',engineJobId:'old-engine'});f.store.put('job',{id:'old-engine',cloudStopped:true,status:'stopped'});await assert.rejects(f.invoke(alice,'project.resume',{projectId:p.id,rentalId:r.id,approved:true}),/SCENE_ALREADY_ATTEMPTED/);assert.equal(f.store.get('film-project',p.id).scenes[1].attempted,false);
});
test('signed media serves original bytes only for current owned verified job with exact origin',async t=>{
 const f=await fixture(t),p=await f.invoke(alice,'project.save',{name:'media',story:'fiction',seconds:10,orientation:'portrait'}),project=f.store.get('film-project',p.id),jid=randomUUID();project.scenes=[{jobId:jid,status:'done'}];f.store.put('film-project',project);f.store.put('job',{id:jid,tenantId:f.users.alice,projectId:p.id,result:{videoVerified:true}});await mkdir(path.join(f.folder,'artifacts',jid),{recursive:true});const bytes=Buffer.from('fixture-only-original-native-audio-video-bytes');await writeFile(path.join(f.folder,'artifacts',jid,'video.mp4'),bytes);
 const ticket=await f.invoke(alice,'media.ticket',{projectId:p.id,index:0});const {createServer}=await import('node:http');const server=createServer((req,res)=>f.platform.handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const url='http://127.0.0.1:'+server.address().port+new URL(ticket.url).pathname+new URL(ticket.url).search;
 const response=await fetch(url,{headers:{origin:'https://front.test','x-forwarded-proto':'https'}});assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),'https://front.test');assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
 assert.equal((await fetch(url,{headers:{origin:'https://evil.test','x-forwarded-proto':'https'}})).status,403);assert.equal((await fetch(url)).status,403);f.store.put('job',{...f.store.get('job',jid),tenantId:f.users.bob});assert.equal((await fetch(url,{headers:{'x-forwarded-proto':'https'}})).status,404);
});

test('whole-film merge uses real local CPU stream copy, verifies native AV and preserves source clips',async t=>{
 const {copyFile}=await import('node:fs/promises'),{execFile}=await import('node:child_process'),{promisify}=await import('node:util'),{createFilmMerger,fileDigest}=await import('../engine/film-merge.mjs');
 const binary=process.env.FILM_FFMPEG_PATH||(process.platform==='win32'?'C:/Users/hp/Documents/Codex/2026-10-27/codex-python-modal-windows-python-modal/outputs/iraqi-film-forge/.venv-text/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe':'ffmpeg');try{await promisify(execFile)(binary,['-version'],{windowsHide:true,timeout:10000});}catch{t.skip('Existing CPU FFmpeg unavailable; no binary downloaded');return;}
 const f=await fixture(t),p=await f.invoke(alice,'project.save',{name:'AV concat fixture',story:'synthetic CPU fixture',seconds:20,orientation:'portrait'}),project=f.store.get('film-project',p.id);project.scenes=[];
 const source=path.join(f.folder,'synthetic-av.mp4');await promisify(execFile)(binary,['-nostdin','-v','error','-y','-f','lavfi','-i','color=c=blue:s=64x64:r=24','-f','lavfi','-i','sine=frequency=400:sample_rate=48000','-t','0.5','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',source],{windowsHide:true,timeout:20000});
 const original=await fileDigest(source);for(let i=0;i<2;i++){const id=randomUUID();await mkdir(path.join(f.folder,'artifacts',id),{recursive:true});await copyFile(source,path.join(f.folder,'artifacts',id,'video.mp4'));project.scenes.push({status:'done',jobId:id});f.store.put('job',{id,tenantId:project.customerId,projectId:project.id,result:{videoVerified:true,sha256:original}});}f.store.put('film-project',project);
 const merger=createFilmMerger({ffmpeg:binary,ffprobe:path.join(f.folder,'missing-ffprobe.exe')}),result=await merger.merge({store:f.store,project});assert.equal(result.audio,true);assert.equal(result.checker,'ffmpeg_full_decode');assert.equal(result.source,'local_cpu_stream_copy_native_audio');assert.equal(result.width,64);assert.equal(result.height,64);assert.ok(result.duration>=1&&result.duration<2);for(const scene of project.scenes)assert.equal(await fileDigest(path.join(f.folder,'artifacts',scene.jobId,'video.mp4')),original);
 project.merge={status:'completed',...result};f.store.put('film-project',project);const ticket=await f.invoke(alice,'media.ticket',{projectId:project.id,index:'merged'});assert.equal(ticket.url.includes('film-exports'),false);await assert.rejects(f.invoke(bob,'media.ticket',{projectId:project.id,index:'merged'}),/NOT_FOUND/);
});
test('missing merge tooling is an honest unavailable state and never changes source scene success',async t=>{
 const {createFilmMerger}=await import('../engine/film-merge.mjs'),f=await fixture(t),p=await f.invoke(alice,'project.save',{name:'unavailable',story:'fixture',seconds:10,orientation:'portrait'}),project=f.store.get('film-project',p.id);project.scenes=[{status:'done',jobId:randomUUID()}];f.store.put('job',{id:project.scenes[0].jobId,tenantId:f.users.alice,projectId:p.id,result:{videoVerified:true},finishedAt:f.now()});project.state='completed';f.store.put('film-project',project);const platform=createFilmPlatform({engine:f.engine,secret:f.secret,origin:'https://fixture.test',startWorker:false,merger:createFilmMerger({ffmpeg:path.join(f.folder,'missing-ffmpeg.exe')})});
 const response=await platform.dispatch(alice,'project.merge',{projectId:p.id});assert.equal(response.merge.status,'unavailable');assert.equal(response.merge.error,'MERGE_UNAVAILABLE');assert.equal(response.state,'completed');assert.equal(response.scenes[0].status,'done');assert.equal(f.provider.calls.length,0);await platform.close();
});

test('admin GPU sample is quote only until explicit matched approval, text config never exposes key',async t=>{
 const f=await fixture(t);const config=await f.invoke(admin,'admin.text.config');assert.equal(config.configured,false);assert.equal('key' in config,false);assert.equal((await f.invoke(alice,'session')).capabilities.referenceUpload,true);
 const q=await f.invoke(admin,'admin.test.quote',{id:f.slot.id,prompt:'Two Iraqi friends in a quiet market. Ali speaks while Hassan listens with his mouth closed.',audioContract:{language:'ar',dialect:'iraqi',mode:'dialogue',lines:[{speaker:'علي',text:'شلونك اليوم؟'}]}});assert.ok(q.id);assert.equal(f.provider.sessions.size,0);assert.equal(f.store.get('film-admin-test',q.id).slotId,f.slot.id);await assert.rejects(f.invoke(admin,'admin.test.execute',{quoteId:q.id}),/APPROVAL_REQUIRED/);
 await f.invoke(admin,'admin.slot.save',{id:f.slot.id,accountId:f.account.id,name:'changed',hourPriceUSD:'4'});await assert.rejects(f.invoke(admin,'admin.test.execute',{quoteId:q.id,approved:true}),/COST_CHANGED/);assert.equal(f.provider.sessions.size,0);
});

function tinyPNG(width=2,height=2){const chunk=(type,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);b.writeUInt32BE(crc32(b.subarray(4,-4)),b.length-4);return b;};const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc(height*(width*4+1)))),chunk('IEND',Buffer.alloc(0))]);}
async function upload(f,ticket,bytes=tinyPNG(),{origin='https://front.test',mime='image/png',headers={},method='PUT',url=ticket.url}={}){const parsed=new URL(url);const req=bytes instanceof Readable?bytes:Readable.from([bytes]);Object.assign(req,{url:parsed.pathname+parsed.search,method,socket:{encrypted:true},headers:{origin,'content-type':mime,...headers}});let status,output='';const seen={};const res={setHeader(k,v){seen[k]=v;},writeHead(s){status=s;},end(b=''){output+=b;}};await f.platform.handler(req,res);return {status,body:output?JSON.parse(output):null,headers:seen};}
const draft=(f,actor=alice)=>f.invoke(actor,'project.save',{name:'Reference test',story:'A coherent story',seconds:20,orientation:'portrait'});
test('reference upload accepts real PNG bytes, private metadata only, one use and exact origin',async t=>{
 const f=await fixture(t),p=await draft(f),ticket=await f.invoke(alice,'project.reference.ticket',{projectId:p.id});
 await assert.rejects(f.invoke(bob,'project.reference.ticket',{projectId:p.id}),/NOT_FOUND/);await assert.rejects(f.invoke(alice,'project.reference.ticket',{projectId:'../outside'}),/NOT_FOUND/);
 assert.equal((await upload(f,ticket,tinyPNG(),{origin:'https://evil.test'})).status,403);
 assert.equal((await upload(f,ticket,tinyPNG(),{method:'OPTIONS'})).status,204);
 const result=await upload(f,ticket);assert.equal(result.status,200);assert.equal(result.headers['Access-Control-Allow-Origin'],'https://front.test');assert.equal((await upload(f,ticket)).status,403);
 const saved=await f.invoke(alice,'project.get',{id:p.id});assert.equal(saved.reference.width,2);assert.equal(saved.reference.size,tinyPNG().length);assert.ok(!JSON.stringify(saved).includes('film-references'));assert.ok(!JSON.stringify(saved).includes('sha256'));assert.equal(f.provider.calls.length,0);
 await assert.rejects(f.invoke(bob,'project.reference.remove',{projectId:p.id}),/NOT_FOUND/);
});
test('private reference preview serves exact bytes with valid current owner ticket only',async t=>{
 const f=await fixture(t),p=await draft(f);await upload(f,await f.invoke(alice,'project.reference.ticket',{projectId:p.id}));await assert.rejects(f.invoke(bob,'project.reference.view',{projectId:p.id}),/NOT_FOUND/);
 const ticket=await f.invoke(alice,'project.reference.view',{projectId:p.id}),{createServer}=await import('node:http'),server=createServer((req,res)=>f.platform.handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const url='http://127.0.0.1:'+server.address().port+new URL(ticket.url).pathname+new URL(ticket.url).search,headers={origin:'https://front.test','x-forwarded-proto':'https'};
 const response=await fetch(url,{headers});assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await response.arrayBuffer()),tinyPNG());assert.equal((await fetch(url,{headers:{...headers,origin:'https://evil.test'}})).status,403);assert.equal((await fetch(url.replace('signature=','signature=0'),{headers})).status,403);
 await f.invoke(alice,'project.reference.remove',{projectId:p.id});assert.equal((await fetch(url,{headers})).status,403);assert.equal((await f.invoke(alice,'project.get',{id:p.id})).reference,null);assert.equal(f.provider.calls.length,0);
});
test('invalid, stale and conflicting reference uploads preserve previous bytes and metadata',async t=>{
 const f=await fixture(t),p=await draft(f);await upload(f,await f.invoke(alice,'project.reference.ticket',{projectId:p.id}));const before=f.store.get('film-project',p.id).reference;
 const failed=await f.invoke(alice,'project.reference.ticket',{projectId:p.id});assert.equal((await upload(f,failed,Buffer.alloc(64))).status,400);assert.equal((await upload(f,failed)).status,403);assert.deepEqual(f.store.get('film-project',p.id).reference,before);assert.equal(f.store.get('film-project',p.id).referenceUploading,undefined);
 const a=await f.invoke(alice,'project.reference.ticket',{projectId:p.id}),b=await f.invoke(alice,'project.reference.ticket',{projectId:p.id});assert.equal((await upload(f,a)).status,200);assert.equal((await upload(f,b)).status,400);
 const expired=await f.invoke(alice,'project.reference.ticket',{projectId:p.id});f.advance(120001);assert.equal((await upload(f,expired)).status,403);
 const badType=await f.invoke(alice,'project.reference.ticket',{projectId:p.id});assert.equal((await upload(f,badType,tinyPNG(),{mime:'text/html'})).status,400);
 const over=await f.invoke(alice,'project.reference.ticket',{projectId:p.id});assert.equal((await upload(f,over,tinyPNG(),{headers:{'content-length':REFERENCE_LIMIT+1}})).status,400);
 const streamOver=await f.invoke(alice,'project.reference.ticket',{projectId:p.id});assert.equal((await upload(f,streamOver,Buffer.alloc(REFERENCE_LIMIT+1))).status,400);
});
test('image parser rejects dimension bombs, bad PNG CRC, mismatched MIME and corrupted compression',()=>{
 assert.deepEqual(inspectReference(tinyPNG(),'image/png'),{width:2,height:2,mime:'image/png'});
 assert.throws(()=>inspectReference(tinyPNG(4097,1),'image/png'),/DIMENSIONS/);assert.throws(()=>inspectReference(tinyPNG(4096,4096),'image/png'),/DIMENSIONS/);
 const bad=tinyPNG();bad[30]^=1;assert.throws(()=>inspectReference(bad,'image/png'),/INVALID/);assert.throws(()=>inspectReference(tinyPNG(),'image/jpeg'),/TYPE/);assert.throws(()=>inspectReference(Buffer.alloc(REFERENCE_LIMIT+1),'image/png'),/SIZE/);
});
test('JPEG fixture is accepted with bounded dimensions; malformed JPEG structures fail',()=>{
 const jpeg=Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDjqKKK+kPAP//Z','base64');
 assert.deepEqual(inspectReference(jpeg,'image/jpeg'),{width:2,height:2,mime:'image/jpeg'});assert.throws(()=>inspectReference(jpeg.subarray(0,-1),'image/jpeg'),/TYPE/);const bomb=Buffer.from(jpeg),sof=bomb.indexOf(Buffer.from('ffc0','hex'));bomb.writeUInt16BE(5000,sof+7);assert.throws(()=>inspectReference(bomb,'image/jpeg'),/DIMENSIONS/);
});
test('claimed upload blocks concurrent project edits, unlink and text before the atomic commit',async t=>{
 const f=await fixture(t,{text:true}),p=await draft(f),ticket=await f.invoke(alice,'project.reference.ticket',{projectId:p.id});let release,entered;const gate=new Promise(r=>release=r),begun=new Promise(r=>entered=r);const stream=Readable.from((async function*(){entered();await gate;yield tinyPNG();})()),task=upload(f,ticket,stream);await begun;
 await assert.rejects(f.invoke(alice,'project.save',{id:p.id,name:'edit',story:p.story,seconds:p.seconds,orientation:p.orientation}),/REFERENCE_LOCKED/);await assert.rejects(f.invoke(alice,'project.reference.remove',{projectId:p.id}),/REFERENCE_LOCKED/);await assert.rejects(f.invoke(alice,'project.reference.ticket',{projectId:p.id}),/REFERENCE_LOCKED/);await assert.rejects(f.invoke(alice,'plan.submit',{projectId:p.id,approved:true}),/REFERENCE_LOCKED/);assert.equal(f.store.all('film-text-reservation').length,0);release();assert.equal((await task).status,200);
});
test('draft saves preserve conversation, report, timestamps and reference except actual planning changes',async t=>{
 const f=await fixture(t),p=await draft(f);await upload(f,await f.invoke(alice,'project.reference.ticket',{projectId:p.id}));const old=f.store.get('film-project',p.id);old.messages=[{role:'user',content:'Keep this conversation'}];old.scenes=[{status:'pending',attempted:false,prompt:'retained plan'}];old.state='planned';old.planningCompletedScenes=2;f.store.put('film-project',old);f.advance(1000);
 const input={id:p.id,name:p.name,story:p.story,seconds:p.seconds,orientation:p.orientation};await f.invoke(alice,'project.save',input);let current=f.store.get('film-project',p.id);assert.deepEqual(current.scenes,old.scenes);assert.deepEqual(current.messages,old.messages);assert.equal(current.createdAt,old.createdAt);
 await f.invoke(alice,'project.save',{...input,name:'Renamed'});assert.equal(f.store.get('film-project',p.id).state,'planned');
 await f.invoke(alice,'project.save',{...input,story:'Different real story'});current=f.store.get('film-project',p.id);assert.deepEqual(current.messages,old.messages);assert.deepEqual(current.reference,old.reference);assert.deepEqual(current.scenes,[]);assert.equal(current.state,'draft');assert.equal(current.planningCompletedScenes,0);assert.equal(current.createdAt,old.createdAt);
 current.scenes=[{attempted:true,status:'done'}];f.store.put('film-project',current);await assert.rejects(f.invoke(alice,'project.save',input),/ATTEMPTED/);await assert.rejects(f.invoke(alice,'project.reference.ticket',{projectId:p.id}),/LOCKED/);await assert.rejects(f.invoke(alice,'project.reference.remove',{projectId:p.id}),/LOCKED/);
});
test('first scene receives stored reference while next scene uses verified last-frame continuation',async t=>{
 const f=await fixture(t);await f.credit(alice);const r=await warm(f,await f.start(alice)),p=await draft(f);await upload(f,await f.invoke(alice,'project.reference.ticket',{projectId:p.id}));const old=f.store.get('film-project',p.id);old.state='planned';old.scenes=[0,1].map(()=>({status:'pending',attempted:false,prompt:'A chronological scene',audioContract:{lines:[{speaker:'علي',text:'شلونك اليوم؟'}]}}));f.store.put('film-project',old);
 const original=f.engine.invoke,captured=[];f.engine.invoke=async(route,b,scope,...rest)=>{if(route==='quote'&&b.action==='generate'){captured.push(b);return {id:'reference-quote-'+captured.length};}if(route==='execute'&&b.quoteId.startsWith('reference-quote-')){const id=randomUUID();f.store.put('job',{id,tenantId:scope.tenantId,rentalId:scope.rentalId,projectId:p.id,status:'completed',cloudStopped:true,result:{videoVerified:true}});return {id};}return original(route,b,scope,...rest);};
 await f.invoke(alice,'project.generate',{projectId:p.id,rentalId:r.id,approved:true});await waitFor(()=>f.store.get('film-project',p.id).state==='completed');assert.equal(captured.length,2);assert.equal(captured[0].initialFrame,'data:image/png;base64,'+tinyPNG().toString('base64'));assert.equal(captured[1].initialFrame,undefined);assert.equal(captured[1].previousSceneId,'scene-0');
});
test('reference quota atomically bounds concurrent retained originals across projects',async t=>{
 const f=await fixture(t,{referenceCustomerByteLimit:REFERENCE_LIMIT}),a=await draft(f),b=await draft(f),ta=await f.invoke(alice,'project.reference.ticket',{projectId:a.id}),tb=await f.invoke(alice,'project.reference.ticket',{projectId:b.id});let release,entered;const gate=new Promise(r=>release=r),begun=new Promise(r=>entered=r);const stream=Readable.from((async function*(){entered();await gate;yield tinyPNG();})()),first=upload(f,ta,stream);await begun;
 const usage=f.store.get('film-reference-usage',f.users.alice);assert.equal(usage.retainedBytes,0);assert.equal(usage.reservedBytes,REFERENCE_LIMIT);const rejected=await upload(f,tb);assert.equal(rejected.body.error,'REFERENCE_QUOTA');assert.equal(f.store.get('film-project',b.id).referenceUploading,undefined);assert.equal(f.store.get('film-reference-ticket',new URL(tb.url).pathname.split('/').at(-1)).consumed,false);
 release();assert.equal((await first).status,200);assert.equal(f.store.get('film-reference-usage',f.users.alice).retainedBytes,tinyPNG().length);assert.equal(f.store.get('film-reference-usage',f.users.alice).reservedBytes,0);await assert.rejects(f.invoke(alice,'project.reference.ticket',{projectId:b.id}),/^Error: REFERENCE_QUOTA$/);
 const bobProject=await draft(f,bob);assert.ok((await f.invoke(bob,'project.reference.ticket',{projectId:bobProject.id})).url);assert.equal(f.provider.calls.length,0);
});
test('failed uploads release reservations; replacement and unlink retain counted originals',async t=>{
 const f=await fixture(t,{referenceCustomerByteLimit:REFERENCE_LIMIT+tinyPNG().length*2}),p=await draft(f);let ticket=await f.invoke(alice,'project.reference.ticket',{projectId:p.id});assert.equal((await upload(f,ticket,Buffer.alloc(64))).status,400);assert.equal(f.store.get('film-reference-usage',f.users.alice).reservedBytes,0);assert.equal(f.store.get('film-reference-usage',f.users.alice).retainedBytes,0);assert.equal(f.store.all('film-reference-reservation')[0].state,'released');
 for(let i=0;i<3;i++){ticket=await f.invoke(alice,'project.reference.ticket',{projectId:p.id});assert.equal((await upload(f,ticket)).status,200);assert.equal(f.store.get('film-reference-usage',f.users.alice).retainedBytes,(i+1)*tinyPNG().length);assert.equal(f.store.get('film-reference-usage',f.users.alice).reservedBytes,0);}
 await f.invoke(alice,'project.reference.remove',{projectId:p.id});assert.equal(f.store.get('film-reference-usage',f.users.alice).retainedBytes,3*tinyPNG().length);assert.equal(f.store.all('film-reference-retained').length,3);await assert.rejects(f.invoke(alice,'project.reference.ticket',{projectId:p.id}),/^Error: REFERENCE_QUOTA$/);
 // Missing usage on a pre-quota installation bootstraps every retained file, not just current pointer.
 f.store.delete('film-reference-usage',f.users.alice);await assert.rejects(f.invoke(alice,'project.reference.ticket',{projectId:p.id}),/^Error: REFERENCE_QUOTA$/); // transaction rollback leaves no partial usage marker
});
test('interrupted reservations remain fail-closed after restart and quota configuration is trusted only',async t=>{
 const f=await fixture(t,{referenceCustomerByteLimit:REFERENCE_LIMIT}),p=await draft(f);f.store.put('film-reference-usage',{id:f.users.alice,retainedBytes:0,reservedBytes:REFERENCE_LIMIT});f.store.put('film-reference-reservation',{id:'interrupted',customerId:f.users.alice,projectId:p.id,bytes:REFERENCE_LIMIT,state:'reserved'});
 const restarted=createFilmPlatform({engine:f.engine,secret:f.secret,origin:'https://fixture.test',startWorker:false,referenceCustomerByteLimit:REFERENCE_LIMIT});await assert.rejects(restarted.dispatch(alice,'project.reference.ticket',{projectId:p.id}),/^Error: REFERENCE_QUOTA$/);assert.equal(f.store.get('film-reference-usage',f.users.alice).reservedBytes,REFERENCE_LIMIT);await restarted.close();
 for(const bad of [0,-1,1.5,REFERENCE_LIMIT-1,Number.NaN,11*1024**3])assert.throws(()=>createFilmPlatform({engine:f.engine,secret:f.secret,origin:'https://fixture.test',startWorker:false,referenceCustomerByteLimit:bad}),/REFERENCE_QUOTA_CONFIGURATION/);
});

test('account emergency stop cancels standalone samples and retains uncertainty until provider confirms',async t=>{
 const f=await fixture(t),job={id:randomUUID(),accountId:f.account.id,action:'generate',status:'running',cloudStopped:false};f.store.put('job',job);
 await assert.rejects(f.invoke(alice,'admin.account.stop',{accountId:f.account.id,approved:true}),/FORBIDDEN/);
 await assert.rejects(f.invoke(admin,'admin.account.stop',{accountId:f.account.id}),/APPROVAL_REQUIRED/);
 f.provider.uncertain=true;const stopped=await f.invoke(admin,'admin.account.stop',{accountId:f.account.id,approved:true});
 assert.ok(f.provider.calls.some(c=>c.action==='stop'&&c.input.jobId===job.id));assert.equal(stopped.confirmed,false);assert.equal(stopped.pending,1);assert.equal(f.store.get('job',job.id).cloudStopped,false);
 const accounts=await f.invoke(admin,'admin.accounts.list');assert.equal(accounts[0].standaloneActiveCount,1);
 f.provider.uncertain=false;const reconciled=await f.invoke(admin,'admin.operation.status',{id:job.id});assert.equal(reconciled.cloudStopped,true);assert.equal((await f.invoke(admin,'admin.accounts.list'))[0].standaloneActiveCount,0);
});

test('slot emergency stop binds standalone test to slot and account without cancelling another slot',async t=>{
 const f=await fixture(t),second=await f.invoke(admin,'admin.slot.save',{accountId:f.account.id,name:'second',hourPriceUSD:'4'}),other={id:randomUUID(),mode:'local_profile',workspace:'other'};f.store.put('account',other);
 const target={id:randomUUID(),accountId:f.account.id,action:'generate',quoteId:randomUUID(),status:'running',cloudStopped:false},otherSlot={id:randomUUID(),accountId:f.account.id,action:'generate',quoteId:randomUUID(),status:'completed',cloudStopped:false},foreign={id:randomUUID(),accountId:other.id,action:'generate',quoteId:randomUUID(),status:'completed',cloudStopped:false};
 // The shared legacy root guard allows only one running standalone job; completed-unconfirmed rows still need explicit control.
 for(const j of [target,otherSlot,foreign])f.store.put('job',j);
 f.store.put('film-admin-test',{id:target.quoteId,slotId:f.slot.id});f.store.put('film-admin-test',{id:otherSlot.quoteId,slotId:second.id});f.store.put('film-admin-test',{id:foreign.quoteId,slotId:f.slot.id});
 const result=await f.invoke(admin,'admin.slot.stop',{id:f.slot.id,approved:true});assert.equal(result.confirmed,true);assert.equal(result.pending,0);assert.equal(result.jobs.length,1);assert.equal(f.store.get('job',target.id).cloudStopped,true);assert.equal(f.store.get('job',otherSlot.id).cloudStopped,false);assert.equal(f.store.get('job',foreign.id).cloudStopped,false);
 await assert.rejects(f.invoke(admin,'admin.slot.stop',{id:randomUUID(),approved:true}),/NOT_FOUND/);
});

test('failed standalone operations keep the catalog and dispatch blocked until confirmed stopped',async t=>{
 const f=await fixture(t);await f.credit(alice);const j={id:randomUUID(),accountId:f.account.id,action:'generate',status:'failed',cloudStopped:false};f.store.put('job',j);
 assert.equal((await f.invoke(alice,'servers.list'))[0].state,'busy');await assert.rejects(f.start(alice),/SERVER_BUSY/);assert.equal(f.provider.sessions.size,0);
 await f.invoke(admin,'admin.account.stop',{accountId:f.account.id,approved:true});assert.equal((await f.invoke(alice,'servers.list'))[0].state,'available');
});

test('account stop includes CPU cloud preparation and follow uses persisted group without restarting',async t=>{
 const f=await fixture(t),job={id:randomUUID(),accountId:f.account.id,sourceId:f.account.id,action:'prepare',plan:{transport:'modal-cpu-cloud',workerApp:'fixture-cpu-only'},estimate:{rate:0},createdAt:f.now(),status:'running',cloudStopped:false};f.store.put('job',job);f.provider.uncertain=true;
 const stopped=await f.invoke(admin,'admin.account.stop',{accountId:f.account.id,approved:true});assert.equal(stopped.confirmed,false);assert.equal(f.store.get('film-admin-stop',stopped.id).jobIds[0],job.id);assert.ok(f.provider.calls.some(c=>c.action==='cloud_transfer_stop'&&c.input.jobId===job.id));
 f.provider.uncertain=false;const follow=await f.invoke(admin,'admin.operation.status',{id:stopped.id});assert.equal(follow.confirmed,true);assert.equal(follow.pending,0);assert.equal(follow.jobs[0].cloudStopped,true);assert.ok(f.provider.calls.every(c=>['cloud_transfer_stop','cloud_transfer_status'].includes(c.action)));assert.equal(f.provider.sessions.size,0);
});

test('private media supports actual byte ranges and rejects expired or unauthorized requests',async t=>{
 const f=await fixture(t),p=await draft(f),jid=randomUUID(),project=f.store.get('film-project',p.id),bytes=Buffer.from('0123456789');project.rentalId='range-fixture';project.scenes=[{jobId:jid,status:'done'}];f.store.put('film-project',project);f.store.put('job',{id:jid,projectId:p.id,rentalId:project.rentalId,tenantId:f.users.alice,status:'completed',cloudStopped:true,result:{videoVerified:true}});const folder=path.join(f.folder,'artifacts',jid);await mkdir(folder,{recursive:true});await writeFile(path.join(folder,'video.mp4'),bytes);
 const ticket=await f.invoke(alice,'media.ticket',{projectId:p.id,index:0}),{createServer}=await import('node:http'),server=createServer((req,res)=>f.platform.handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const pathAndQuery=new URL(ticket.url).pathname+new URL(ticket.url).search,url='http://127.0.0.1:'+server.address().port+pathAndQuery,headers={'x-forwarded-proto':'https',origin:'https://front.test'};
 for(const [range,expected,contentRange] of [['bytes=2-5','2345','bytes 2-5/10'],['bytes=7-','789','bytes 7-9/10'],['bytes=-3','789','bytes 7-9/10'],['bytes=8-99','89','bytes 8-9/10']]){const response=await fetch(url,{headers:{...headers,range}});assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),contentRange);assert.equal(response.headers.get('accept-ranges'),'bytes');assert.equal(await response.text(),expected);}
 for(const range of ['bytes=10-','bytes=7-2','bytes=1-2,4-5','bytes=-0','items=1-2','bytes=-']){const response=await fetch(url,{headers:{...headers,range}});assert.equal(response.status,416);assert.equal(response.headers.get('content-range'),'bytes */10');assert.equal(await response.text(),'');}
 const head=await fetch(url,{method:'HEAD',headers});assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),'10');assert.equal(await head.text(),'');assert.deepEqual(Buffer.from(await (await fetch(url,{headers})).arrayBuffer()),bytes);
 await assert.rejects(f.invoke(bob,'media.ticket',{projectId:p.id,index:0}),/NOT_FOUND/);assert.equal((await fetch(url,{headers:{...headers,origin:'https://evil.test',range:'bytes=0-2'}})).status,403);f.advance(180001);assert.equal((await fetch(url,{headers:{...headers,range:'bytes=0-2'}})).status,403);assert.equal(f.provider.calls.length,0);
});

test('administrator emergency cancellation is not serialized behind unrelated slow discovery',async t=>{
 const f=await fixture(t),job={id:randomUUID(),accountId:f.account.id,action:'generate',status:'running',cloudStopped:false};f.store.put('job',job);let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r),original=f.provider.call.bind(f.provider);f.provider.call=async(action,input)=>{if(action==='discover'){entered();await gate;return {ready:true,files:[]};}return original(action,input);};
 const discovery=f.invoke(admin,'admin.account.inspect',{accountId:f.account.id});await started;try{const stopped=await Promise.race([f.invoke(admin,'admin.account.stop',{accountId:f.account.id,approved:true}),new Promise((_,reject)=>setTimeout(()=>reject(Error('STOP_BLOCKED_BY_DISCOVERY')),250))]);assert.equal(stopped.confirmed,true);}finally{release();await discovery;}
});

test('failed standalone resources retain account access until confirmed stopped, including source credentials',async t=>{
 const f=await fixture(t),a={id:randomUUID(),mode:'local_profile',workspace:'unlink-fixture'},j={id:randomUUID(),accountId:a.id,sourceId:f.account.id,action:'prepare',status:'failed',cloudStopped:false};f.store.put('account',a);f.store.put('job',j);
 await assert.rejects(f.invoke(admin,'admin.account.unlink',{accountId:a.id,approved:true}),/STOP_AND_RECONCILE/);await assert.rejects(f.engine.invoke('accounts/'+a.id,undefined,undefined,'DELETE'),/STOP_AND_RECONCILE/);assert.ok(f.store.get('account',a.id));
 await assert.rejects(f.engine.invoke('accounts/'+f.account.id,undefined,undefined,'DELETE'),/STOP_AND_RECONCILE/);j.cloudStopped=true;f.store.put('job',j);assert.equal((await f.invoke(admin,'admin.account.unlink',{accountId:a.id,approved:true})).unlinked,true);assert.equal(f.store.get('account',a.id),null);assert.equal(f.provider.calls.length,0);
});

test('empty account stop reports only recorded operation scope and never claims provider-wide zero',async t=>{
 const f=await fixture(t),result=await f.invoke(admin,'admin.account.stop',{accountId:f.account.id,approved:true});assert.equal(result.pending,0);assert.equal(result.jobs.length,0);assert.match(result.message,/ليس جرداً/);assert.equal(f.provider.calls.length,0);
});

test('completed attached clips count one rental and do not consume the second account slot',async t=>{
 const f=await fixture(t);await f.credit(alice);await f.credit(bob);const r=await warm(f,await f.start(alice)),second=await f.invoke(admin,'admin.slot.save',{accountId:f.account.id,name:'second',hourPriceUSD:'4'});f.store.put('film-slot',{...second,published:true,locked:false});
 f.store.put('job',{id:randomUUID(),tenantId:f.users.alice,rentalId:r.id,engineSlotId:f.slot.id,accountId:f.account.id,attachedEngineId:r.engineJobId,createdAt:Date.now(),estimate:{rate:0,resourceWindowUSD:0},action:'generate',status:'completed',cloudStopped:false,result:{videoVerified:true}});
 let a=(await f.invoke(admin,'admin.accounts.list'))[0];assert.equal(a.activeCount,1);assert.equal(a.standaloneActiveCount,0);assert.equal((await f.invoke(bob,'servers.list')).find(s=>s.id===second.id).state,'available');
 const q=await f.invoke(bob,'rental.quote',{serverId:second.id}),other=await f.invoke(bob,'rental.start',{serverId:second.id,priceMicroUSD:q.priceMicroUSD,revision:q.revision,approved:true,requestId:'second-with-child'});await warm(f,other);a=(await f.invoke(admin,'admin.accounts.list'))[0];assert.equal(a.activeCount,2);assert.equal(f.provider.sessions.size,2);
});

test('standalone attached clips share their parent count and only one cancellation command',async t=>{
 const f=await fixture(t),parent={id:randomUUID(),accountId:f.account.id,action:'start',status:'ready',cloudStopped:false,appId:'fixture-app'},child={id:randomUUID(),accountId:f.account.id,action:'generate',status:'completed',cloudStopped:false,appId:parent.appId,attachedEngineId:parent.id,result:{videoVerified:true}};f.store.put('job',parent);f.store.put('job',child);
 assert.equal((await f.invoke(admin,'admin.accounts.list'))[0].standaloneActiveCount,1);const stopped=await f.invoke(admin,'admin.account.stop',{accountId:f.account.id,approved:true});assert.equal(stopped.confirmed,true);assert.equal(f.provider.calls.filter(c=>c.action==='stop').length,1);
});

test('shutdown attempts standalone failed-resource cancellation without clearing unconfirmed state',async t=>{
 const folder=await mkdtemp(path.join(tmpdir(),'film-shutdown-')),key=randomBytes(32).toString('base64'),store=new Store(folder,key);store.installRentalSchema();const account={id:randomUUID(),mode:'local_profile',workspace:'shutdown-only'},provider=new Provider();store.put('account',account);const engine=await createEngineAPI({folder,key,store,provider,allowPaid:false,origin:'https://fixture.test'}),job={id:randomUUID(),accountId:account.id,action:'generate',status:'failed',cloudStopped:false};store.put('job',job);provider.uncertain=true;
 try{await engine.close();assert.equal(provider.calls.filter(c=>c.action==='stop'&&c.input.jobId===job.id).length,1);const reopened=new Store(folder,key);try{const saved=reopened.get('job',job.id);assert.equal(saved.cloudStopped,false);assert.equal(saved.status,'uncertain');assert.ok(saved.stopRequestedAt);}finally{await reopened.close();}}finally{await rm(folder,{recursive:true,force:true});}
});

test('independent accounts route customer sessions separately and reassign invalidates old quotes without changing history',async t=>{
 const f=await fixture(t),backup={...f.account,id:randomUUID(),workspace:'backup-workspace',volume:'backup-volume'};f.store.put('account',backup);
 const second=await f.invoke(admin,'admin.slot.save',{accountId:f.account.id,name:'second',hourPriceUSD:'3'});f.store.put('film-slot',{...second,published:true,testingOnly:true,locked:false});
 await f.credit(alice);await f.credit(bob);
 const oldQuote=await f.invoke(bob,'rental.quote',{serverId:second.id});
 f.store.put('rental',{id:'historic',customerId:f.users.bob,engineSlotId:second.id,accountId:f.account.id,state:'closed',chargedMicroUSD:12345});
 await assert.rejects(f.invoke(alice,'admin.slot.reassign',{id:second.id,accountId:backup.id,approved:true}),/FORBIDDEN/);
 await assert.rejects(f.invoke(admin,'admin.slot.reassign',{id:second.id,accountId:backup.id}),/APPROVAL_REQUIRED/);
 const moved=await f.invoke(admin,'admin.slot.reassign',{id:second.id,accountId:backup.id,approved:true});
 assert.equal(moved.locked,true);assert.equal(moved.published,true);assert.equal(moved.revision,second.revision+1);assert.equal(moved.testJobId,null);assert.equal(f.provider.calls.length,0);
 assert.equal(f.store.get('rental','historic').accountId,f.account.id);assert.equal(f.store.get('rental','historic').chargedMicroUSD,12345);
 await f.invoke(admin,'admin.slot.lock',{id:second.id,locked:false});
 await assert.rejects(f.invoke(bob,'rental.start',{...oldQuote,serverId:second.id,approved:true,requestId:'stale-route'}),/COST_CHANGED/);
 const a=await warm(f,await f.start(alice));
 await assert.rejects(f.invoke(admin,'admin.slot.reassign',{id:second.id,accountId:f.account.id,approved:true}),/ACCOUNT_IN_USE/);
 assert.equal((await f.invoke(bob,'servers.list')).find(s=>s.id===second.id).state,'available');
 const q=await f.invoke(bob,'rental.quote',{serverId:second.id}),b=await warm(f,await f.invoke(bob,'rental.start',{...q,serverId:second.id,approved:true,requestId:'backup-session'}));
 assert.equal(f.store.get('job',b.engineJobId).accountId,backup.id);assert.equal(f.store.get('job',a.engineJobId).accountId,f.account.id);
 assert.equal(f.provider.calls.filter(c=>c.action==='session').find(c=>c.input.jobId===b.engineJobId).input.credentials.expectedWorkspace,'backup-workspace');
 assert.equal(f.provider.sessions.size,2);
});

test('standalone jobs block only their own known account; unknown legacy account remains global',async t=>{
 const f=await fixture(t),backup={...f.account,id:randomUUID(),workspace:'backup'};f.store.put('account',backup);
 const second=await f.invoke(admin,'admin.slot.save',{accountId:backup.id,name:'backup',hourPriceUSD:'3'});f.store.put('film-slot',{...second,published:true,locked:false});await f.credit(bob);
 f.store.put('job',{id:randomUUID(),accountId:f.account.id,action:'start',status:'uncertain',cloudStopped:false,createdAt:Date.now()});
 const catalog=await f.invoke(bob,'servers.list');assert.equal(catalog.find(s=>s.id===f.slot.id).state,'busy');assert.equal(catalog.find(s=>s.id===second.id).state,'available');
 const q=await f.invoke(bob,'rental.quote',{serverId:second.id});await warm(f,await f.invoke(bob,'rental.start',{...q,serverId:second.id,approved:true,requestId:'independent'}));
 f.store.put('job',{id:randomUUID(),action:'prepare',status:'uncertain',cloudStopped:false});assert.equal((await f.invoke(alice,'servers.list')).find(s=>s.id===second.id).state,'busy');
});

test('confirmed customer stop closes billing without ENGINE_STOPPED failure alert; unexpected stop still alerts',async t=>{
 const f=await fixture(t);await f.credit(alice);const r=await warm(f,await f.start(alice));
 await f.invoke(alice,'rental.stop',{id:r.id,approved:true});await waitFor(()=>f.store.get('job',r.engineJobId).cloudStopped);await f.platform.tick();
 assert.equal(f.store.get('rental',r.id).state,'closed');assert.equal(f.store.all('film-alert').some(a=>a.reason==='ENGINE_STOPPED'),false);
 const next=await warm(f,await f.start(alice));f.store.put('job',{...f.store.get('job',next.engineJobId),status:'stopped',cloudStopped:true});await f.platform.tick();assert.ok(f.store.all('film-alert').some(a=>a.reason==='ENGINE_STOPPED'&&a.subject===next.id));
});

test('a mapped but unprepared account stays visible locked and cannot be opened or rented',async t=>{
 const f=await fixture(t),backup={...f.account,id:randomUUID(),workspace:'missing-files',activated:false,discovery:{ready:false,productionQuality:{files:[{name:'vae/missing',present:false,size:null}]}}};f.store.put('account',backup);
 f.store.put('film-slot',{...f.slot,published:true,testingOnly:true});await f.invoke(admin,'admin.slot.reassign',{id:f.slot.id,accountId:backup.id,approved:true});
 await assert.rejects(f.invoke(admin,'admin.slot.lock',{id:f.slot.id,locked:false}),/WEIGHTS_NOT_READY/);
 const entry=(await f.invoke(alice,'servers.list'))[0];assert.equal(entry.state,'locked');assert.match(entry.availability,/تجهيز/);assert.equal(f.provider.calls.length,0);
 const metadata=await f.invoke(admin,'admin.accounts.list');assert.equal(metadata.find(a=>a.id===backup.id).files[0].present,false);
});

test('discussion duration is persisted in the hidden project and explicit ready-to-write prepares scenes without GPU',async t=>{
 const f=await fixture(t,{text:true}),p=await draft(f);const original=f.engine.invoke;let current,details=0,discussions=0;
 f.engine.invoke=async(route,b,...rest)=>{
  if(route==='llm/calls'){current=b;if(b.mode==='details')details++;else discussions++;return {status:'queued'};}
  if(route.startsWith('llm/calls/'))return current.mode==='discuss'?{status:'completed',discussion:{reply:'نرتب قصة عشرين ثانية، تريد أكتبها؟',proposed_duration_seconds:20,style:'realistic',ready_to_write:discussions>1},text:'unused'}:{status:'completed',text:JSON.stringify({scenes:[1,2].map(()=>({prompt:'Ali speaks while Zainab listens in an old Iraqi courtyard. No lettering.',audioContract:{language:'ar',dialect:'iraqi',mode:'dialogue',lines:[{speaker:'علي',text:'شلونج زينب؟'}]}}))})};
  return original(route,b,...rest);
 };
 await f.invoke(alice,'chat.submit',{projectId:p.id,message:'اريد قصة عشرين ثانية',approved:true});await waitFor(()=>!f.store.get('film-project',p.id).textPending);
 assert.equal(f.store.get('film-project',p.id).seconds,20);assert.equal(details,0);assert.equal(f.provider.calls.length,0);
 await f.invoke(alice,'chat.submit',{projectId:p.id,message:'ابدا اكتب القصة',approved:true});await waitFor(()=>f.store.get('film-project',p.id).state==='planned'&&!f.store.get('film-project',p.id).textPending);
 assert.equal(details,1);assert.equal((await f.invoke(alice,'project.get',{id:p.id})).scenes.length,2);assert.equal(f.provider.calls.length,0);
});

test('single production approval durably claims one launch; repeated requests cannot allocate a second session',async t=>{
 const f=await fixture(t,{text:true}),p=await draft(f);await f.credit(alice);f.store.put('config',{id:'openai-director',credentials:'local-fixture-presence-only'});
 const planned=f.store.get('film-project',p.id);planned.state='planned';planned.scenes=[{prompt:'An Iraqi courtyard',audioContract:{language:'ar',dialect:'iraqi',mode:'dialogue',lines:[{speaker:'علي',text:'شلونك اليوم؟'}]},status:'pending',attempted:false}];f.store.put('film-project',planned);
 const q=await f.invoke(alice,'rental.quote',{serverId:f.slot.id}),input={projectId:p.id,...q,approved:true,requestId:'launch-once'};
 await assert.rejects(f.invoke(alice,'project.launch',{...input,approved:false}),/APPROVAL_REQUIRED/);
 await assert.rejects(f.invoke(bob,'project.launch',input),/NOT_FOUND/);
 const results=await Promise.all([f.invoke(alice,'project.launch',input),f.invoke(alice,'project.launch',{...input,requestId:'double-click'})]);
 assert.equal(results[0].id,results[1].id);await waitFor(()=>f.store.all('rental').length===1);await waitFor(()=>f.provider.sessions.size===1);
 await f.invoke(alice,'project.launch',{...input,requestId:'reload'});assert.equal(f.store.all('rental').length,1);assert.equal(f.provider.sessions.size,1);
 const saved=f.store.get('film-project',p.id);assert.equal(saved.launch.started,true);assert.equal(saved.launch.serverId,f.slot.id);
 // No external provider or GPU exists in this local fixture. Close before generation dispatch.
 await f.platform.close();
});

test('launch checks the writer key and reserves review budget before any rental or supplier dispatch',async t=>{
 const f=await fixture(t,{text:true}),p=await draft(f);await f.credit(alice);const saved=f.store.get('film-project',p.id);saved.state='planned';saved.scenes=[{status:'pending',attempted:false}];f.store.put('film-project',saved);
 const q=await f.invoke(alice,'rental.quote',{serverId:f.slot.id}),input={...q,projectId:p.id,approved:true,requestId:'preflight'};
 await assert.rejects(f.invoke(alice,'project.launch',input),/OPENAI_KEY_REQUIRED/);assert.equal(f.store.all('rental').length,0);assert.equal(f.provider.calls.length,0);
 f.store.put('config',{id:'openai-director',credentials:'synthetic-presence-only'});f.store.put('film-text-reservation',{id:'prior-budget',customerId:f.users.bob,reservedMicroUSD:2000000,calls:1,createdAt:f.now()});
 await assert.rejects(f.invoke(alice,'project.launch',input),/TEXT_BUDGET_LIMIT/);assert.equal(f.store.all('rental').length,0);assert.equal(f.provider.calls.length,0);assert.equal(f.store.get('film-project',p.id).launch,undefined);
});

test('generated file library serves owned downloads with attachment headers, caps expiry and permanently removes approved files',async t=>{
 const f=await fixture(t),p=await draft(f),j={id:randomUUID(),projectId:p.id,tenantId:f.users.alice,action:'generate',status:'completed',cloudStopped:true,finishedAt:f.now(),result:{videoVerified:true}};
 const project=f.store.get('film-project',p.id);project.state='completed';project.scenes=[{jobId:j.id,status:'done',attempted:true}];f.store.put('film-project',project);f.store.put('job',j);
 const folder=path.join(f.folder,'artifacts',j.id);await mkdir(folder,{recursive:true});const bytes=Buffer.alloc(200,7);await writeFile(path.join(folder,'video.mp4'),bytes);
 const files=await f.invoke(alice,'files.list');assert.equal(files.length,1);assert.deepEqual(await f.invoke(bob,'files.list'),[]);await assert.rejects(f.invoke(bob,'files.ticket',{id:files[0].id}),/NOT_FOUND/);await assert.rejects(f.invoke(alice,'files.delete',{id:files[0].id}),/APPROVAL_REQUIRED/);
 const {createServer}=await import('node:http'),server=createServer((req,res)=>f.platform.handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const ticket=await f.invoke(alice,'files.ticket',{id:files[0].id,download:true}),url='http://127.0.0.1:'+server.address().port+new URL(ticket.url).pathname+new URL(ticket.url).search;
 const response=await fetch(url,{headers:{origin:'https://front.test','x-forwarded-proto':'https'}});assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/^attachment;/);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
 await f.invoke(alice,'files.delete',{id:files[0].id,approved:true});assert.deepEqual(await f.invoke(alice,'files.list'),[]);assert.equal(f.store.get('film-media',files[0].id),null);assert.equal(f.store.get('job',j.id).status,'completed');assert.equal(f.provider.calls.length,0);
 assert.equal((await fetch(url,{headers:{origin:'https://front.test','x-forwarded-proto':'https'}})).status,404);
});


test('a damaged media folder cannot interrupt rental metering or claim a supplier start',async t=>{
 const f=await fixture(t),pid=randomUUID(),jid=randomUUID();
 f.store.put('film-project',{id:pid,customerId:'alice',name:'Retention fixture',state:'completed',scenes:[{jobId:jid,status:'done'}]});
 f.store.put('job',{id:jid,projectId:pid,tenantId:'alice',action:'generate',status:'completed',cloudStopped:true,finishedAt:Date.now(),result:{videoVerified:true}});
 await writeFile(path.join(f.folder,'artifacts'),'invalid directory fixture');
 await f.platform.tick();assert.ok(f.store.all('film-alert').some(a=>a.reason==='MEDIA_CLEANUP_PENDING'));assert.equal(f.provider.calls.length,0);
});


test('an uploaded reference attaches once to the discussion, preserves assigned role, and strips internal markers before writer dispatch',async t=>{
 const f=await fixture(t,{text:true}),p=await draft(f);const ticket=await f.invoke(alice,'project.reference.ticket',{projectId:p.id});assert.equal((await upload(f,ticket)).status,200);
 const calls=[];f.engine.invoke=async(route,b)=>{if(route==='llm/calls'){calls.push(b);assert.ok(b.messages.every(m=>Object.keys(m).every(k=>['role','content'].includes(k))));return {status:'queued'};}return {status:'completed',discussion:{reply:'زينب هي الشخصية بالصورة؛ نحافظ على وصفها.',proposed_duration_seconds:20,style:'realistic',ready_to_write:false},text:'unused'};};
 await f.invoke(alice,'chat.submit',{projectId:p.id,message:'هاي الصورة لشخصية زينب، ناقشني بيها',approved:true});await waitFor(()=>!f.store.get('film-project',p.id).textPending);
 let dto=await f.invoke(alice,'project.get',{id:p.id});assert.equal(dto.messages[0].hasReference,true);assert.equal('referenceId' in dto.messages[0],false);assert.ok(calls[0].messages.some(m=>m.content.includes('زينب')));
 await f.invoke(alice,'chat.submit',{projectId:p.id,message:'خلي زينب تلبس نفس الملابس',approved:true});await waitFor(()=>!f.store.get('film-project',p.id).textPending);
 dto=await f.invoke(alice,'project.get',{id:p.id});assert.equal(dto.messages.filter(m=>m.hasReference).length,1);assert.equal(f.provider.calls.length,0);
});
