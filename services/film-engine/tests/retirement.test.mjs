import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {Store} from '../engine/store.mjs';
import {createEngineAPI} from '../engine/api.mjs';
import {createFilmPlatform} from '../engine/film-platform.mjs';
import {settings,estimate,quality} from '../engine/config.mjs';
const admin={id:'admin',email:'admin@fixture.test',isAdmin:true},customer={id:'customer',email:'customer@fixture.test',isAdmin:false};
async function fixture(t){
 const folder=await mkdtemp(path.join(tmpdir(),'film-retire-')),store=new Store(folder,randomBytes(32).toString('base64'));store.installRentalSchema();
 const calls=[],provider={call:async(action)=>{calls.push(action);throw Error('CLOUD_FORBIDDEN');},session:()=>{throw Error('GPU_FORBIDDEN');}};
 const primary={id:randomUUID(),role:'primary',workspace:'basm1998ali',mode:'local_profile'},account={id:randomUUID(),role:'backup',workspace:'secondary-fixture',label:'secondary',volume:'existing-volume',mode:'token',createdAt:123,activated:true,discovery:{ready:true}};
 account.credentials=store.seal({tokenId:'ak-synthetic-test-only',tokenSecret:'as-synthetic-test-only'},account.id);account.hf=store.seal({token:'hf-synthetic-test-only'},account.id);store.put('account',primary);store.put('account',account);
 const engine=await createEngineAPI({folder,store,key:randomBytes(32).toString('base64'),provider,allowPaid:true,allowCustomerRentals:true});
 const platform=createFilmPlatform({engine,origin:'https://fixture.test',secret:'retirement-test-only-bridge-secret-1234567890',enabled:true,startWorker:false,closeTimeoutMs:30});
 const invoke=(op,input={})=>platform.dispatch(admin,op,input);const slot=await invoke('admin.slot.save',{accountId:account.id,name:'first',hourPriceUSD:'3.60',gpu:'L40S'});
 const user=(await platform.dispatch(customer,'session')).user;await invoke('admin.credit.add',{customerId:user.id,amountUSD:'2',requestId:'test-credit'});
 t.after(async()=>{for(const j of store.all('job'))store.put('job',{...j,cloudStopped:true});for(const r of store.all('rental'))store.put('rental',{...r,state:'closed'});await platform.close();await engine.close();await rm(folder,{recursive:true,force:true});});
 return {folder,store,engine,platform,invoke,account,primary,slot,user,calls,provider};
}
test('retire locks permanently, retains row/rate and excludes admission/publication',async t=>{
 const f=await fixture(t);f.store.put('film-slot',{...f.slot,published:true,locked:false});
 await assert.rejects(f.platform.dispatch(customer,'admin.slot.retire',{id:f.slot.id,approved:true}),/FORBIDDEN/);
 await assert.rejects(f.invoke('admin.slot.retire',{id:f.slot.id}),/APPROVAL_REQUIRED/);
 const retired=await f.invoke('admin.slot.retire',{id:f.slot.id,approved:true});assert.equal(retired.retired,true);assert.equal(retired.published,false);assert.equal(retired.locked,true);assert.equal(f.store.get('film-slot',f.slot.id).hourMicros,3600000);
 assert.deepEqual(await f.platform.dispatch(customer,'servers.list'),[]);
 for(const [op,input] of [['admin.slot.publish',{id:f.slot.id}],['admin.slot.lock',{id:f.slot.id,locked:false}],['admin.slot.verify',{id:f.slot.id,jobId:'none',reviewed:true}],['admin.slot.save',{id:f.slot.id,accountId:f.account.id,name:'revive',hourPriceUSD:'1'}],['admin.test.quote',{id:f.slot.id,prompt:'no',audioContract:{}}]])await assert.rejects(f.invoke(op,input),/SLOT_RETIRED/);
 await assert.rejects(f.platform.dispatch(customer,'rental.quote',{serverId:f.slot.id}),/SERVER_LOCKED/);
 await assert.rejects(f.platform.dispatch(customer,'rental.start',{serverId:f.slot.id,revision:f.slot.revision,priceMicroUSD:f.slot.hourMicros,approved:true,requestId:'retired-start'}),/SERVER_LOCKED/);assert.equal(f.calls.length,0);
});
test('retirement refuses all unconfirmed account/source jobs and rentals without implicit stop',async t=>{
 const f=await fixture(t);for(const fields of [{accountId:f.account.id,status:'failed'},{sourceId:f.account.id,status:'completed'}]){const j={id:randomUUID(),action:'prepare',cloudStopped:false,...fields};f.store.put('job',j);await assert.rejects(f.invoke('admin.slot.retire',{id:f.slot.id,approved:true}),/ACCOUNT_IN_USE/);assert.ok(!f.store.get('film-slot',f.slot.id).retired);f.store.put('job',{...j,cloudStopped:true});}
 f.store.put('rental',{id:'uncertain',accountId:f.account.id,engineSlotId:f.slot.id,customerId:f.user.id,state:'uncertain'});await assert.rejects(f.invoke('admin.slot.retire',{id:f.slot.id,approved:true}),/ACCOUNT_IN_USE/);assert.equal(f.calls.length,0);
});
test('replacement counts only active slots and never inherits retired GPU',async t=>{
 const f=await fixture(t);await f.invoke('admin.slot.retire',{id:f.slot.id,approved:true});const second=await f.invoke('admin.slot.save',{accountId:f.account.id,name:'replacement',hourPriceUSD:'2'});assert.equal(second.gpu,'RTX-PRO-6000');
 const third=await f.invoke('admin.slot.save',{accountId:f.account.id,name:'second-active',hourPriceUSD:'2'});assert.equal(third.gpu,second.gpu);await assert.rejects(f.invoke('admin.slot.save',{accountId:f.account.id,name:'third-active',hourPriceUSD:'2'}),/MAX_TWO_SLOTS/);assert.equal(f.store.all('film-slot').length,3);
});
test('unlink removes encrypted credentials and selection only, archives safe metadata and preserves all history/media',async t=>{
 const f=await fixture(t);await assert.rejects(f.invoke('admin.account.unlink',{accountId:f.account.id,approved:true}),/ACCOUNT_IN_USE/);
 const project=await f.platform.dispatch(customer,'project.save',{name:'history',story:'keep',seconds:10,orientation:'landscape'});f.store.put('rental',{id:'closed-history',accountId:f.account.id,engineSlotId:f.slot.id,customerId:f.user.id,state:'closed',hourMicros:f.slot.hourMicros});f.store.put('config',{id:'selection',accountId:f.account.id});
 await mkdir(path.join(f.folder,'artifacts'),{recursive:true});const file=path.join(f.folder,'artifacts','preserved-video.mp4');await writeFile(file,'synthetic video bytes');
 const wallet=await f.platform.dispatch(customer,'wallet'),ledger=f.store.all('film-ledger');await f.invoke('admin.slot.retire',{id:f.slot.id,approved:true});
 await assert.rejects(f.invoke('admin.account.unlink',{accountId:f.account.id}),/APPROVAL_REQUIRED/);
 const result=await f.invoke('admin.account.unlink',{accountId:f.account.id,approved:true});assert.equal(result.unlinked,true);assert.equal(result.remoteResourcesDeleted,false);assert.equal(result.providerTokenRevoked,false);assert.equal(f.store.get('account',f.account.id),null);assert.equal(f.store.get('config','selection'),null);
 const archive=f.store.get('account-archive',f.account.id);assert.equal(archive.workspace,'secondary-fixture');assert.equal(archive.createdAt,123);assert.ok(!('credentials' in archive));assert.ok(!('hf' in archive));assert.ok(!JSON.stringify(archive).includes('synthetic-test'));
 assert.ok(!JSON.stringify(f.store.all('account-archive')).includes(f.account.credentials));
 assert.equal((await f.platform.dispatch(customer,'project.get',{id:project.id})).story,'keep');assert.deepEqual(await f.platform.dispatch(customer,'wallet'),wallet);assert.deepEqual(f.store.all('film-ledger'),ledger);assert.equal(f.store.get('rental','closed-history').hourMicros,3600000);assert.equal(await readFile(file,'utf8'),'synthetic video bytes');
 const archived=(await f.invoke('admin.accounts.list')).find(a=>a.id===f.account.id);assert.equal(archived.unlinked,true);assert.equal(archived.slots[0].retired,true);assert.ok(!('credentials' in archived));assert.equal(f.calls.length,0);
});
test('admitted reservation wins retirement race without allocating cloud resources',async t=>{
 const f=await fixture(t);f.store.put('film-slot',{...f.slot,published:true,locked:false});
 const gated=createFilmPlatform({engine:{...f.engine,invoke:()=>new Promise(()=>{})},origin:'https://fixture.test',secret:'reservation-race-test-only-1234567890123456',enabled:true,startWorker:false,closeTimeoutMs:10});
 const r=await gated.dispatch(customer,'rental.start',{serverId:f.slot.id,revision:f.slot.revision,priceMicroUSD:f.slot.hourMicros,approved:true,requestId:'reservation-wins'});
 assert.equal(r.state,'reserved');await assert.rejects(f.invoke('admin.slot.retire',{id:f.slot.id,approved:true}),/ACCOUNT_IN_USE/);assert.ok(!f.store.get('film-slot',f.slot.id).retired);assert.equal(f.calls.length,0);f.store.put('rental',{...f.store.get('rental',r.id),state:'closed'});await gated.close();
});
test('unlink and replacement creation serialize without dangling live slots',async t=>{
 const f=await fixture(t);await f.invoke('admin.slot.retire',{id:f.slot.id,approved:true});
 const values=await Promise.allSettled([f.invoke('admin.account.unlink',{accountId:f.account.id,approved:true}),f.invoke('admin.slot.save',{accountId:f.account.id,name:'replacement',hourPriceUSD:'2'})]);
 assert.ok(values.some(v=>v.status==='rejected'));const live=f.store.all('film-slot').filter(s=>s.accountId===f.account.id&&!s.retired);assert.ok(!live.length||f.store.get('account',f.account.id));assert.equal(f.calls.length,0);
});
test('engine execution rechecks retired proof inside the same transaction before admitting a job',async t=>{
 const f=await fixture(t);const config=settings({gpu:'RTX-PRO-6000'}),q={id:randomUUID(),accountId:f.account.id,action:'start',settings:config,quality,estimate:estimate(config),expiresAt:Date.now()+60000};f.store.put('quote',q);f.store.put('film-admin-test',{id:q.id,slotId:f.slot.id,revision:f.slot.revision});await f.invoke('admin.slot.retire',{id:f.slot.id,approved:true});
 await assert.rejects(f.engine.invoke('execute',{quoteId:q.id,approvedCost:true}),/SLOT_RETIRED/);assert.equal(f.store.all('job').length,0);assert.equal(f.calls.length,0);
});
test('late readonly account metadata cannot resurrect unlinked credentials',async t=>{
 const f=await fixture(t);let entered,release;const started=new Promise(r=>entered=r),waiting=new Promise(r=>release=r);
 f.provider.call=async action=>{f.calls.push(action);if(action==='discover'){entered();await waiting;return {ready:false,files:[]};}if(action==='quality_discover')return {ready:false,files:[]};throw Error('CLOUD_FORBIDDEN');};
 // A trusted internal slot-scoped readonly quote can overlap the global unlink queue.
 const scope={tenantId:f.user.id,rentalId:randomUUID(),engineSlotId:f.slot.id,accountId:f.account.id};
 const quote=f.engine.invoke('quote',{action:'start',accountId:f.account.id,settings:{gpu:'RTX-PRO-6000'}},scope).catch(()=>null);
 await started;await f.invoke('admin.slot.retire',{id:f.slot.id,approved:true});await f.invoke('admin.account.unlink',{accountId:f.account.id,approved:true});release();await quote;
 assert.equal(!!f.store.get('account',f.account.id),false);assert.ok(f.store.get('account-archive',f.account.id));assert.ok(f.calls.every(a=>['discover','quality_discover'].includes(a)));
});
test('primary and source/destination uncertain resources block engine unlink as well as film path',async t=>{
 const f=await fixture(t);await assert.rejects(f.invoke('admin.account.unlink',{accountId:f.primary.id,approved:true}),/PRIMARY_ACCOUNT_IS_FIXED/);await assert.rejects(f.engine.invoke('accounts/'+f.primary.id,undefined,undefined,'DELETE'),/PRIMARY_ACCOUNT_IS_FIXED/);
 await f.invoke('admin.slot.retire',{id:f.slot.id,approved:true});const j={id:randomUUID(),sourceId:f.account.id,action:'prepare',status:'failed',cloudStopped:false};f.store.put('job',j);await assert.rejects(f.invoke('admin.account.unlink',{accountId:f.account.id,approved:true}),/STOP_AND_RECONCILE_JOBS_FIRST/);assert.ok(f.store.get('account',f.account.id)?.credentials);assert.equal(f.calls.length,0);
});
test('transaction ordering closes retire/start and stale mutation races',async t=>{
 const f=await fixture(t);f.store.put('film-slot',{...f.slot,published:true,locked:false});
 const retired=await Promise.allSettled([f.invoke('admin.slot.retire',{id:f.slot.id,approved:true}),f.platform.dispatch(customer,'rental.start',{serverId:f.slot.id,revision:f.slot.revision,priceMicroUSD:f.slot.hourMicros,approved:true,requestId:'race'})]);assert.equal(retired[0].status,'fulfilled');assert.equal(retired[1].status,'rejected');assert.equal(f.store.all('rental').length,0);
 const r=await Promise.allSettled([f.invoke('admin.slot.lock',{id:f.slot.id,locked:false}),f.invoke('admin.slot.publish',{id:f.slot.id}),f.invoke('admin.slot.save',{id:f.slot.id,accountId:f.account.id,name:'revive',hourPriceUSD:'1'})]);assert.ok(r.every(x=>x.status==='rejected'));assert.equal(f.store.get('film-slot',f.slot.id).locked,true);assert.equal(f.calls.length,0);
});
