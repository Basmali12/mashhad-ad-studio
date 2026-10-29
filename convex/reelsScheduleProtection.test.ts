import {it,expect,vi,afterEach} from 'vitest';
import {convexTest} from 'convex-test';import schema from './schema';import {api} from './_generated/api';
const modules=import.meta.glob('./**/!(*.test).ts');afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
async function setup(past=false){
 const now=Date.parse('2026-10-17T13:00:00+03:00');vi.spyOn(Date,'now').mockReturnValue(now);vi.stubEnv('OWNER_SUBJECT','a');vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN','https://fixture');vi.stubEnv('PUBLISHING_SAAS_ENABLED','true');vi.stubEnv('CONVEX_SITE_URL','http://127.0.0.1:43241');vi.stubEnv('PUBLISHING_REAL_SEND_ENABLED','true');vi.stubEnv('REELS_RUNNER_ENABLED','true');
 const t=convexTest(schema,modules),a=t.withIdentity({subject:'a',issuer:'https://fixture'});await a.mutation(api.publishingUsers.register,{});
 const video={id:'published-video',title:'Published',createdAt:now-600000,bunnyAssetId:'asset-a',publishAt:new Date(now-(past?86400000:60000)).toISOString(),metadataReviewed:true,channelIds:['channel'],metadata:{title:'Published',description:'Original description',hashtags:[],categoryId:'22',madeForKids:false,privacy:'public' as const,isAiGenerated:false}};
 const ids=await t.run(async c=>{
 const subscription=await c.db.insert('reelsSubscriptions',{subject:'a',planCode:'fixture',startsAt:now-2*86400000,expiresAt:now+28*86400000,videoLimit:60,platformLimit:1,platforms:['tiktok'],enabled:true});
 const connection=await c.db.insert('publishingBufferPersonalConnections',{subject:'a',accountId:'account',revision:'rev',encryptedKey:'fixture',fingerprint:'fixture',organizations:[],channels:[{id:'channel',name:'Channel',service:'tiktok',type:'profile',organizationId:'org',isDisconnected:false,isLocked:false}],selectedChannelIds:['channel'],needsReconnect:false,verifiedAt:now});
 const binding=await c.db.insert('reelsBufferBindings',{subject:'a',authMode:'personal',accountId:'account',revision:'rev',connectionId:connection,approvedChannelIds:['channel'],channelLimit:1,subscriptionId:subscription,lockedAt:now,needsReview:false,suspended:false});await c.db.patch(subscription,{bufferBindingId:binding});
 const assets=[];for(const [key,hash] of [['asset-a','a'],['asset-b','b'],['asset-c','c']])assets.push(await c.db.insert('mediaAssets',{subject:'a',key,sha256:hash.repeat(64),zone:'fixture',objectPath:key,size:16,type:'video/mp4',createdAt:now,verifiedAt:now}));
 await c.db.insert('reelsUploadUsage',{subject:'a',subscriptionId:subscription,assetKey:'a'.repeat(64),acceptedAt:now-600000});
 const collection=await c.db.insert('publishingCollections',{subject:'a',id:'folder',name:'F',version:1,updatedAt:now,libraryVideos:[video]});
 const job=await c.db.insert('reelsJobs',{subject:'a',key:'published-job',assetId:assets[0],collectionId:'folder',videoId:video.id,metadata:video.metadata,authMode:'personal',connectionRevision:'rev',dueAt:Date.parse(video.publishAt),createdAt:now-600000,dryRun:false,cancelled:false});
 const delivery=await c.db.insert('reelsDeliveries',{subject:'a',jobId:job,channelId:'channel',platform:'tiktok',phase:'published',providerId:'confirmed-fixture',dueAt:Date.parse(video.publishAt),attempts:1,updatedAt:now-1000});return {collection,delivery,job};
 });return {t,a,video,now,...ids};
}
it('rejects direct API deletion or edits using the authoritative receipt even without a local publishedAt marker',async()=>{
 const {t,a,video,delivery}=await setup();await expect(a.mutation(api.publishingCollections.save,{collection:{id:'folder',name:'F',libraryVideos:[]},expectedVersion:1})).rejects.toThrow('منشور');
 await expect(a.mutation(api.publishingCollections.save,{collection:{id:'folder',name:'F',libraryVideos:[{...video,title:'Changed'}]},expectedVersion:1})).rejects.toThrow('منشور');
 expect((await a.query(api.publishingCollections.get,{id:'folder'}))?.version).toBe(1);expect((await t.run(c=>c.db.get(delivery)))?.providerId).toBe('confirmed-fixture');
});
it('preserves the first published video when adding the second today and rejects a third atomically',async()=>{
 const {t,a,video,now}=await setup();const second={...video,id:'second',title:'Second',bunnyAssetId:'asset-b',createdAt:now,publishAt:new Date(now+3600000).toISOString(),metadata:{...video.metadata,title:'Second'}};
 await a.mutation(api.publishingCollections.save,{collection:{id:'folder',name:'F',libraryVideos:[video,second]},expectedVersion:1});const saved=await a.query(api.publishingCollections.get,{id:'folder'});expect(saved?.libraryVideos[0]).toEqual(video);expect(saved?.libraryVideos).toHaveLength(2);expect((await a.query(api.reelsBilling.state,{})).remaining).toBe(58);
 const third={...second,id:'third',bunnyAssetId:'asset-c',publishAt:new Date(now+7200000).toISOString()};await expect(a.mutation(api.publishingCollections.save,{collection:{id:'folder',name:'F',libraryVideos:[video,second,third]},expectedVersion:2})).rejects.toThrow('فيديوان');expect((await a.query(api.publishingCollections.get,{id:'folder'}))?.libraryVideos).toHaveLength(2);expect(await t.run(c=>c.db.query('reelsJobs').collect())).toHaveLength(2);
});
it('keeps an ended day immutable even if publication failed, while retaining all history',async()=>{
 const {t,a,video,delivery}=await setup(true);await t.run(c=>c.db.patch(delivery,{phase:'failed',providerId:undefined}));await expect(a.mutation(api.publishingCollections.save,{collection:{id:'folder',name:'F',libraryVideos:[]},expectedVersion:1})).rejects.toThrow('منتهي');expect((await a.query(api.publishingCollections.get,{id:'folder'}))?.libraryVideos).toEqual([video]);
});
