import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {ModalProvider} from '../engine/provider.mjs';
import {createEngineAPI} from '../engine/api.mjs';
import {createFilmPlatform} from '../engine/film-platform.mjs';
import {Store} from '../engine/store.mjs';
import {manifest,quality,modelConfigured} from '../engine/config.mjs';

test('retired production adapter cannot spawn inference even with paid flags',async()=>{
 const provider=new ModalProvider(path.resolve('does-not-exist-python'));
 await assert.rejects(provider.call('generate',{paidApproved:true}),/ENGINE_NOT_CONFIGURED/);
 await assert.rejects(provider.call('session',{paidApproved:true}),/ENGINE_NOT_CONFIGURED/);
 assert.throws(()=>provider.session({paidApproved:true}),/ENGINE_NOT_CONFIGURED/);
 assert.equal(modelConfigured,false);assert.deepEqual(manifest.files,{});
 assert.equal(quality.pipeline,null);assert.equal(quality.nativeAudio,false);
});

test('old execution quotes fail before jobs, rental reservations or provider calls',async t=>{
 const folder=await mkdtemp(path.join(tmpdir(),'model-retirement-'));
 const store=new Store(folder,randomBytes(32).toString('base64'));store.installRentalSchema();
 const provider=new ModalProvider(path.resolve(folder,'absent-python'));
 const api=await createEngineAPI({store,folder,provider,allowPaid:true,allowCustomerRentals:true});
 const platform=createFilmPlatform({engine:api,origin:'https://fixture.test',secret:'retirement-fixture-secret-01234567890123456789',enabled:true,startWorker:false});
 t.after(async()=>{await platform.close();await api.close();await rm(folder,{recursive:true,force:true});});
 const oldId=randomUUID();store.put('quote',{id:oldId,action:'generate',approvedCost:true,createdAt:Date.now()});
 for(const action of ['start','generate','prepare'])await assert.rejects(api.invoke('quote',{action,accountId:randomUUID()}),/ENGINE_NOT_CONFIGURED/);
 await assert.rejects(api.invoke('execute',{quoteId:oldId,approvedCost:true}),/ENGINE_NOT_CONFIGURED/);
 const actor={id:'retirement-customer',email:'fixture@example.test',isAdmin:true};
 for(const op of ['rental.quote','rental.start','project.launch','project.generate','project.resume','admin.prepare.execute','admin.test.execute','admin.slot.publish'])await assert.rejects(platform.dispatch(actor,op,{approved:true}),/ENGINE_NOT_CONFIGURED/);
 const session=await platform.dispatch(actor,'session');assert.equal(session.enabled,false);
 assert.equal(session.capabilities.genericEngineDefinitions,true);assert.equal(session.capabilities.legacyProduction,false);assert.equal(session.capabilities.lastFrameContinuity,false);assert.equal(session.capabilities.nativeAudio,false);
 assert.equal((await store.all('job')).length,0);assert.equal((await store.all('rental')).length,0);
 assert.equal((await store.all('film-credit')).length,0);assert.ok(await store.get('quote',oldId));
 assert.deepEqual(await platform.dispatch(actor,'files.list'),[]);
});
