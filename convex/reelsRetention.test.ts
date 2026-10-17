import {afterEach,expect,it,vi} from 'vitest';
import {convexTest} from 'convex-test';
import schema from './schema';
import {api,internal} from './_generated/api';
import {scheduleRetention,RETENTION_MS} from './reelsRetention';
const modules=import.meta.glob('./**/!(*.test).ts');
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
async function setup(){
 vi.stubEnv('REELS_RETENTION_ENABLED','true');
 const t=convexTest(schema,modules),published=Date.now()-RETENTION_MS-1000;
 const ids=await t.run(async c=>{
  await c.db.insert('publishingUsers',{subject:'a',name:'Fixture',createdAt:1,disabled:false});
  const asset=await c.db.insert('mediaAssets',{subject:'a',key:'a'.repeat(64),sha256:'a'.repeat(64),zone:'fixture',objectPath:'fixture',size:24,type:'video/mp4',verifiedAt:1,createdAt:1});
  const job=await c.db.insert('reelsJobs',{subject:'a',key:'one',assetId:asset,collectionId:'c',videoId:'v',metadata:{},authMode:'personal',connectionRevision:'r',dueAt:1,dryRun:false,createdAt:1,cancelled:false});
  const rows=[];for(const channelId of ['youtube','tiktok'])rows.push(await c.db.insert('reelsDeliveries',{subject:'a',jobId:job,channelId,platform:channelId,phase:'published',providerId:channelId,attempts:1,dueAt:1,updatedAt:published}));
  await c.db.insert('publishingCollections',{subject:'a',id:'c',name:'c',version:1,libraryVideos:[{id:'v',bunnyAssetId:'a'.repeat(64)}],updatedAt:1});
  return {asset,job,rows};
 });return {t,...ids,published};
}
it('arms exactly 48 hours from the last confirmed destination, once',async()=>{
 const {t,asset,rows}=await setup();const now=Date.now();await t.run(c=>c.db.patch(rows[1],{updatedAt:now}));
 await t.run(c=>scheduleRetention(c,asset));await t.run(c=>scheduleRetention(c,asset));
 expect((await t.run(c=>c.db.get(asset)))?.retentionDeleteAt).toBe(now+RETENTION_MS);
 expect(await t.mutation(internal.reelsRetention.claim,{assetId:asset})).toBeNull();
 expect(await t.run(c=>c.db.system.query('_scheduled_functions').collect())).toHaveLength(1);
});
it.each(['accepted','uncertain','failed','sending','queued','retry','paused'])('never arms cleanup for a %s destination',async phase=>{
 const {t,asset,rows}=await setup();await t.run(c=>c.db.patch(rows[1],{phase}));await t.run(c=>scheduleRetention(c,asset));
 expect((await t.run(c=>c.db.get(asset)))?.retentionDeleteAt).toBeUndefined();
 expect(await t.mutation(internal.reelsRetention.claim,{assetId:asset})).toBeNull();
});
it('rejects a missing receipt, dry runs and legacy Convex originals',async()=>{
 for(const variant of ['receipt','dry','original']){const {t,asset,job,rows}=await setup();await t.run(async c=>{if(variant==='receipt')await c.db.patch(rows[0],{providerId:undefined});if(variant==='dry')await c.db.patch(job,{dryRun:true});if(variant==='original')await c.db.patch(asset,{originalStorageId:await c.storage.store(new Blob(['fixture']))});});await t.run(c=>scheduleRetention(c,asset));expect((await t.run(c=>c.db.get(asset)))?.retentionDeleteAt).toBeUndefined();}
});
it('retains unscheduled references and rechecks a newly queued job before deleting',async()=>{
 const {t,asset,job}=await setup();await t.run(c=>scheduleRetention(c,asset));
 await t.run(async c=>{const j=(await c.db.get(job))!;const {_id,_creationTime,...data}=j;void _id;void _creationTime;await c.db.insert('reelsJobs',{...data,key:'two',videoId:'other'});});
 expect(await t.mutation(internal.reelsRetention.claim,{assetId:asset})).toBeNull();
 const other=await setup();await other.t.run(async c=>{await c.db.insert('publishingCollections',{subject:'a',id:'other',name:'other',version:1,libraryVideos:[{id:'other',bunnyAssetId:'a'.repeat(64)}],updatedAt:1});await scheduleRetention(c,other.asset);});
 expect((await other.t.run(c=>c.db.get(other.asset)))?.retentionDeleteAt).toBeUndefined();
});
it('uses a persistent fence, rejects other tokens, preserves receipts and closes access after completion',async()=>{
 const {t,asset,job}=await setup();await t.run(c=>scheduleRetention(c,asset));
 const claim=await t.mutation(internal.reelsRetention.claim,{assetId:asset});expect(claim).not.toBeNull();
 expect(await t.mutation(internal.reelsRetention.claim,{assetId:asset})).toEqual(claim);
 await expect(t.query(internal.reelsRetention.authorized,{assetId:asset,fence:'foreign'})).rejects.toThrow();
 await expect(t.query(internal.reelsStorage.asset,{subject:'b',key:'a'.repeat(64)})).rejects.toThrow();
 await t.mutation(internal.reelsRetention.completed,{assetId:asset,fence:claim!.fence});
 expect((await t.run(c=>c.db.get(asset)))?.deletedAt).toBeGreaterThan(0);
 expect(await t.run(c=>c.db.get(job))).not.toBeNull();expect(await t.run(c=>c.db.query('reelsDeliveries').collect())).toHaveLength(2);
 expect(await t.mutation(internal.reelsRetention.claim,{assetId:asset})).toBeNull();
 await expect(t.query(internal.reelsStorage.asset,{subject:'a',key:'a'.repeat(64)})).rejects.toThrow();
});
it('keeps the file pending on service failure and retries without releasing its fence',async()=>{
 const {t,asset}=await setup();await t.run(c=>scheduleRetention(c,asset));vi.stubEnv('REELS_STORAGE_ORIGIN','https://scan.example/reels-api');vi.stubEnv('REELS_STORAGE_BRIDGE_SECRET','s'.repeat(40));
 const fetcher=vi.fn().mockResolvedValue(new Response('',{status:503}));vi.stubGlobal('fetch',fetcher);
 await t.action(internal.reelsRetention.purge,{assetId:asset});const row=await t.run(c=>c.db.get(asset));expect(row?.deletedAt).toBeUndefined();expect(row?.deletionPending).toBe(true);expect(row?.retentionNextAttemptAt).toBeGreaterThan(Date.now());expect(fetcher).toHaveBeenCalledTimes(1);
});
it('is disabled by default and revokes even an unexpired download grant at the deadline',async()=>{
 const {t,asset}=await setup();await t.run(c=>scheduleRetention(c,asset));await expect(t.query(internal.reelsStorage.asset,{subject:'a',key:'a'.repeat(64)})).rejects.toThrow();
 vi.stubEnv('REELS_RETENTION_ENABLED','false');expect(await t.mutation(internal.reelsRetention.claim,{assetId:asset})).toBeNull();
 expect((await t.query(internal.reelsStorage.asset,{subject:'a',key:'a'.repeat(64)})).subject).toBe('a');
});
it('arms from the actual send and observation hooks only after every destination finishes',async()=>{
 const {t,asset,rows}=await setup();
 await t.run(async c=>{await c.db.patch(rows[0],{phase:'sending',fence:'send'});await c.db.patch(rows[1],{phase:'accepted',statusFence:'observe',statusLeaseUntil:Date.now()+60000});});
 await t.mutation(internal.reelsJobs.result,{id:rows[0],fence:'send',phase:'published',providerId:'youtube'});
 expect((await t.run(c=>c.db.get(asset)))?.retentionDeleteAt).toBeUndefined();
 await t.mutation(internal.reelsJobs.observe,{id:rows[1],fence:'observe',providerId:'tiktok',status:'sent'});
 expect((await t.run(c=>c.db.get(asset)))?.retentionDeleteAt).toBeGreaterThan(Date.now()+RETENTION_MS-2000);
});
it('keeps historical cards saveable after binary deletion but forbids changing them',async()=>{
 const {t,asset}=await setup();vi.stubEnv('PUBLISHING_SAAS_ENABLED','true');vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN','https://fixture');
 const video={id:'v',title:'History',publishAt:'',createdAt:1,bunnyAssetId:'a'.repeat(64)};
 await t.run(async c=>{const col=(await c.db.query('publishingCollections').first())!;await c.db.patch(col._id,{libraryVideos:[video]});await c.db.patch(asset,{deletedAt:Date.now()});});
 const a=t.withIdentity({subject:'a',issuer:'https://fixture'});
 await a.mutation(api.publishingCollections.save,{collection:{id:'c',name:'c',libraryVideos:[{...video}]},expectedVersion:1});
 await expect(a.mutation(api.publishingCollections.save,{collection:{id:'c',name:'c',libraryVideos:[{...video,title:'Changed'}]},expectedVersion:2})).rejects.toThrow();
});
