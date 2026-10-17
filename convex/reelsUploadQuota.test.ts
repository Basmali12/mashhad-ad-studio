import {afterEach,expect,it,vi} from 'vitest';
import {convexTest} from 'convex-test';
import schema from './schema';
import {api,internal} from './_generated/api';
import {reserveVideo,settleVideo} from './reelsBilling';
const modules=import.meta.glob('./**/!(*.test).ts');
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
async function setup(){
 vi.stubEnv('OWNER_SUBJECT','owner');vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN','https://fixture');vi.stubEnv('PUBLISHING_SAAS_ENABLED','true');vi.stubEnv('BUNNY_STORAGE_ZONE','fixture');
 const t=convexTest(schema,modules),owner=t.withIdentity({subject:'owner',issuer:'https://fixture'}),a=t.withIdentity({subject:'a',issuer:'https://fixture'}),b=t.withIdentity({subject:'b',issuer:'https://fixture'});
 for(const c of [owner,a,b])await c.mutation(api.publishingUsers.register,{});return {t,owner,a,b};
}
it('offers exactly the three prices and saves choice without granting allowance',async()=>{
 const {a,b}=await setup();const plans=await a.query(api.reelsBilling.plans,{});expect(plans.map(p=>[p.priceCents,p.videoLimit,p.platformLimit])).toEqual([[500,15,3],[1000,60,3],[1500,60,4]]);
 await a.mutation(api.reelsBilling.choosePlan,{code:'reels-15-3'});expect((await a.query(api.reelsBilling.state,{})).requestedPlan?.code).toBe('reels-15-3');expect((await b.query(api.reelsBilling.state,{})).requestedPlan).toBeNull();
 await expect(a.mutation(api.publishingUploadTickets.begin,{size:24,type:'video/mp4'})).rejects.toThrow('اشتراك');
});
it('blocks linking before administrator activation without contacting Buffer',async()=>{
 const {a}=await setup();const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);await a.mutation(api.reelsBilling.choosePlan,{code:'reels-15-3'});
 await expect(a.action(api.publishingBufferPersonal.connect,{key:'private-fixture-key-a'})).rejects.toThrow('اشتراك');expect(fetcher).not.toHaveBeenCalled();expect((await a.query(api.publishingBufferPersonal.state,{})).locked).toBe(false);
});
it('atomically holds the last upload slot and charges only verified bytes, once per hash',async()=>{
 const {t,a,owner}=await setup();const sub=await owner.mutation(api.reelsBilling.assign,{subject:'a',planCode:'reels-15-3',platforms:['facebook','instagram','tiktok']});await t.run(c=>c.db.patch(sub,{videoLimit:1}));
 const attempts=await Promise.allSettled([1,2].map(()=>a.mutation(api.publishingUploadTickets.begin,{size:24,type:'video/mp4'})));expect(attempts.filter(x=>x.status==='fulfilled')).toHaveLength(1);const ticket=(attempts.find(x=>x.status==='fulfilled') as PromiseFulfilledResult<import('./_generated/dataModel').Id<'publishingUploadTickets'>>).value;
 expect((await a.query(api.reelsBilling.state,{})).remaining).toBe(0);expect((await a.query(api.reelsBilling.state,{})).uploaded).toBe(0);
 const hash='a'.repeat(64),ownerHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('a')))).map(n=>n.toString(16).padStart(2,'0')).join('');
 const args={subject:'a',key:hash,sha256:hash,objectPath:`media/${ownerHash}/${hash}.mp4`,size:24,type:'video/mp4',ticketId:ticket};await t.mutation(internal.mediaAssets.recordVerified,args);await t.mutation(internal.mediaAssets.recordVerified,args);
 expect(await a.query(api.reelsBilling.state,{})).toMatchObject({uploaded:1,remaining:0,uploading:0});expect(await t.run(c=>c.db.query('reelsUploadUsage').collect())).toHaveLength(1);
 expect((await a.query(api.reelsBilling.availableUploads,{})).map(r=>r.key)).toEqual([hash]);
 const reservation=await t.run(c=>reserveVideo(c,'a',hash,['tiktok'],Date.now()));expect((await a.query(api.reelsBilling.state,{})).remaining).toBe(0);
 const assetId=await t.run(c=>c.db.query('mediaAssets').first());const job=await t.run(c=>c.db.insert('reelsJobs',{subject:'a',key:'test-failure',assetId:assetId!._id,collectionId:'q',videoId:'v',metadata:{},authMode:'personal',connectionRevision:'fixture',dueAt:1,dryRun:false,createdAt:1,cancelled:false,reservationId:reservation}));
 await t.run(c=>c.db.insert('reelsDeliveries',{subject:'a',jobId:job,channelId:'tiktok',platform:'tiktok',phase:'failed',attempts:1,dueAt:1,updatedAt:1}));await t.run(c=>settleVideo(c,reservation));expect((await a.query(api.reelsBilling.state,{})).remaining).toBe(0);
 const asset=await t.run(c=>c.db.query('mediaAssets').first());await t.run(c=>c.db.patch(asset!._id,{deletedAt:Date.now()}));expect((await a.query(api.reelsBilling.state,{})).remaining).toBe(0);
});
it('cannot release a running upload with client cancel or a stale failure fence',async()=>{
 const {t,a,owner}=await setup();await owner.mutation(api.reelsBilling.assign,{subject:'a',planCode:'reels-15-3',platforms:['facebook','instagram','tiktok']});
 const ticket=await a.mutation(api.publishingUploadTickets.begin,{size:24,type:'video/mp4'}),fence=await a.mutation(api.publishingUploadTickets.start,{id:ticket});await a.mutation(api.publishingUploadTickets.cancel,{id:ticket});expect((await a.query(api.reelsBilling.state,{})).remaining).toBe(14);
 await expect(a.mutation(api.publishingUploadTickets.start,{id:ticket})).rejects.toThrow('جهاز آخر');await t.mutation(internal.publishingUploadTickets.failed,{subject:'a',id:ticket,fence:'stale'});expect((await a.query(api.reelsBilling.state,{})).remaining).toBe(14);
 await t.mutation(internal.publishingUploadTickets.failed,{subject:'a',id:ticket,fence});expect((await a.query(api.reelsBilling.state,{})).remaining).toBe(15);
});
it('releases cancelled/expired holds, rejects a foreign cancel, and does not accept uploads after expiry',async()=>{
 const {t,a,b,owner}=await setup();const sub=await owner.mutation(api.reelsBilling.assign,{subject:'a',planCode:'reels-15-3',platforms:['facebook','instagram','tiktok']});
 const ticket=await a.mutation(api.publishingUploadTickets.begin,{size:24,type:'video/mp4'});await expect(b.mutation(api.publishingUploadTickets.cancel,{id:ticket})).rejects.toThrow('لا يخص');await a.mutation(api.publishingUploadTickets.cancel,{id:ticket});expect((await a.query(api.reelsBilling.state,{})).remaining).toBe(15);
 await expect(a.query(api.publishingUploadTickets.inspect,{id:ticket})).rejects.toThrow('منتهي');
 const pending=await a.mutation(api.publishingUploadTickets.begin,{size:24,type:'video/mp4'});await t.run(c=>c.db.patch(pending,{expiresAt:0}));expect((await a.query(api.reelsBilling.state,{})).remaining).toBe(15);
 await t.run(c=>c.db.patch(sub,{expiresAt:0}));await expect(a.mutation(api.publishingUploadTickets.begin,{size:24,type:'video/mp4'})).rejects.toThrow('اشتراك');
});
it('validates the fixed platform set and rejects self-activation or invented plan codes',async()=>{
 const {a,owner}=await setup();await expect(a.mutation(api.reelsBilling.choosePlan,{code:'free-unlimited'})).rejects.toThrow('الباقة');await expect(a.mutation(api.reelsBilling.assign,{subject:'a',planCode:'reels-60-4',platforms:['tiktok','facebook','instagram','youtube']})).rejects.toThrow();
 await expect(owner.mutation(api.reelsBilling.assign,{subject:'a',planCode:'reels-15-3',platforms:['youtube']})).rejects.toThrow('منصات');
});
it('rejects 3 videos in one day even in a single API payload; preserves quota on re-save and removal',async()=>{
 const {t,a,owner}=await setup();await owner.mutation(api.reelsBilling.assign,{subject:'a',planCode:'reels-60-4',platforms:['facebook','instagram','tiktok','youtube']});
 const day=new Date(Date.now()+86400000).toISOString().slice(0,10),metadata={title:'عنوان',description:'وصف',hashtags:[],categoryId:'22',madeForKids:false,privacy:'public' as const,isAiGenerated:false};
 const videos=await Promise.all([1,2,3].map(async n=>{const key=String(n).repeat(64);await t.run(c=>c.db.insert('mediaAssets',{subject:'a',key,sha256:key,objectPath:'fixture',zone:'fixture',size:24,type:'video/mp4',verifiedAt:1,createdAt:1}));return {id:'v'+n,title:'عنوان',bunnyAssetId:key,createdAt:1,publishAt:day+`T${String(n+10)}:00:00+03:00`,metadata};}));
 await expect(a.mutation(api.publishingCollections.save,{collection:{id:'queue',name:'Q',libraryVideos:videos},expectedVersion:0})).rejects.toThrow('فيديوان');expect((await a.query(api.reelsBilling.state,{})).remaining).toBe(60);
 const collection={id:'queue',name:'Q',libraryVideos:videos.slice(0,2)};await a.mutation(api.publishingCollections.save,{collection,expectedVersion:0});expect((await a.query(api.reelsBilling.state,{})).remaining).toBe(58);
 await a.mutation(api.publishingCollections.save,{collection,expectedVersion:1});expect((await a.query(api.reelsBilling.state,{})).remaining).toBe(58);
 await expect(a.mutation(api.publishingCollections.save,{collection:{id:'other',name:'Other',libraryVideos:[videos[2]]},expectedVersion:0})).rejects.toThrow('فيديوان');
 await a.mutation(api.publishingCollections.save,{collection:{...collection,libraryVideos:[]},expectedVersion:2});expect((await a.query(api.reelsBilling.state,{})).remaining).toBe(58);
 const outside={...videos[0],publishAt:new Date(Date.now()+31*86400000).toISOString()};await expect(a.mutation(api.publishingCollections.save,{collection:{...collection,libraryVideos:[outside]},expectedVersion:3})).rejects.toThrow('الثلاثين');
});
it('persists per-video opt-in and refuses to create deliveries for unchecked or foreign channels',async()=>{
 const {t,a,owner}=await setup();const sub=await owner.mutation(api.reelsBilling.assign,{subject:'a',planCode:'reels-60-3',platforms:['facebook','instagram','tiktok']});
 await t.run(async c=>{const connectionId=await c.db.insert('publishingBufferPersonalConnections',{subject:'a',accountId:'account-a',revision:'r',fingerprint:'fixture',encryptedKey:'fixture',organizations:[],channels:[{id:'tik',name:'T',service:'tiktok',type:'profile',organizationId:'org',isLocked:false,isDisconnected:false},{id:'fb',name:'F',service:'facebook',type:'page',organizationId:'org',isLocked:false,isDisconnected:false}],selectedChannelIds:['tik','fb'],needsReconnect:false,verifiedAt:1});const id=await c.db.insert('reelsBufferBindings',{subject:'a',authMode:'personal',accountId:'account-a',revision:'r',connectionId,approvedChannelIds:['tik','fb'],channelLimit:3,subscriptionId:sub,lockedAt:1,needsReview:false,suspended:false});await c.db.patch(sub,{bufferBindingId:id});});
 const key='e'.repeat(64);await t.run(c=>c.db.insert('mediaAssets',{subject:'a',key,sha256:key,objectPath:'fixture',zone:'fixture',size:24,type:'video/mp4',verifiedAt:1,createdAt:1}));
 const dueAt=Date.now()+86400000,video={id:'v',title:'Title',createdAt:1,bunnyAssetId:key,publishAt:new Date(dueAt).toISOString(),channelIds:['tik'],metadataReviewed:true,metadata:{title:'Title',description:'Description',hashtags:[],categoryId:'22',madeForKids:false,privacy:'public' as const,isAiGenerated:false}},collection={id:'opt-in',name:'Q',libraryVideos:[video]};
 await expect(a.mutation(api.publishingCollections.save,{collection:{...collection,libraryVideos:[{...video,channelIds:['foreign']}]},expectedVersion:0})).rejects.toThrow();
 await a.mutation(api.publishingCollections.save,{collection,expectedVersion:0});expect((await a.query(api.publishingCollections.get,{id:'opt-in'}))?.libraryVideos[0].channelIds).toEqual(['tik']);
 await expect(a.mutation(api.reelsJobs.create,{collectionId:'opt-in',videoId:'v',channelIds:['fb'],authMode:'personal',dueAt,dryRun:true})).rejects.toThrow();
 const job=await a.mutation(api.reelsJobs.create,{collectionId:'opt-in',videoId:'v',channelIds:['tik'],authMode:'personal',dueAt,dryRun:true});expect((await t.run(c=>c.db.query('reelsDeliveries').withIndex('by_job',q=>q.eq('jobId',job)).collect())).map(d=>d.channelId)).toEqual(['tik']);
 await expect(a.mutation(api.publishingCollections.save,{collection:{...collection,libraryVideos:[{...video,channelIds:['fb']}]},expectedVersion:1})).rejects.toThrow('السيرفر');
});

it('rejects past placement and past edits through the API while preserving unchanged history and quota',async()=>{
 const {t,a,owner}=await setup();await owner.mutation(api.reelsBilling.assign,{subject:'a',planCode:'reels-60-4',platforms:['facebook','instagram','tiktok','youtube']});
 const key='d'.repeat(64);await t.run(c=>c.db.insert('mediaAssets',{subject:'a',key,sha256:key,objectPath:'fixture',zone:'fixture',size:24,type:'video/mp4',verifiedAt:1,createdAt:1}));
 const past=new Date(Date.now()-60000).toISOString(),metadata={title:'Title',description:'Description',hashtags:[],categoryId:'22',madeForKids:false,privacy:'public' as const,isAiGenerated:false};
 const video={id:'v',title:'Title',createdAt:1,bunnyAssetId:key,publishAt:past,metadata},collection={id:'past-time',name:'Q',libraryVideos:[video]};
 for(const publishAt of [past,new Date(Date.now()).toISOString(),new Date(Date.now()-86400000).toISOString()])await expect(a.mutation(api.publishingCollections.save,{collection:{...collection,libraryVideos:[{...video,publishAt}]},expectedVersion:0})).rejects.toThrow('مستقبلياً');
 await t.run(c=>c.db.insert('publishingCollections',{...collection,subject:'a',version:1,updatedAt:1}));
 await a.mutation(api.publishingCollections.save,{collection,expectedVersion:1});
 for(const patch of [{title:'Changed'},{publishAt:new Date(Date.now()+86400000).toISOString()},{channelIds:['foreign']}])await expect(a.mutation(api.publishingCollections.save,{collection:{...collection,libraryVideos:[{...video,...patch}]},expectedVersion:2})).rejects.toThrow('الموعد انتهى');
 expect((await a.query(api.reelsBilling.state,{})).remaining).toBe(60);
 expect((await a.query(api.publishingCollections.get,{id:'past-time'}))?.libraryVideos[0]).toEqual(video);
});

it('cannot remove a scheduled video while a delivery may still run, and keeps history and quota after cancellation',async()=>{
 const {t,a,owner}=await setup();await owner.mutation(api.reelsBilling.assign,{subject:'a',planCode:'reels-60-4',platforms:['facebook','instagram','tiktok','youtube']});
 const key='c'.repeat(64),dueAt=Date.now()+86400000,assetId=await t.run(c=>c.db.insert('mediaAssets',{subject:'a',key,sha256:key,objectPath:'fixture',zone:'fixture',size:24,type:'video/mp4',verifiedAt:1,createdAt:1}));
 const video={id:'v',title:'Title',createdAt:1,bunnyAssetId:key,publishAt:new Date(dueAt).toISOString(),metadata:{title:'Title',description:'Description',hashtags:[],categoryId:'22',madeForKids:false,privacy:'public' as const,isAiGenerated:false}},collection={id:'delete-day',name:'Q',libraryVideos:[video]};
 await a.mutation(api.publishingCollections.save,{collection,expectedVersion:0});
 const job=await t.run(c=>c.db.insert('reelsJobs',{subject:'a',key:'queued-delete',assetId,collectionId:collection.id,videoId:'v',metadata:video.metadata,authMode:'personal',connectionRevision:'r',dueAt,dryRun:true,createdAt:1,cancelled:false}));
 const delivery=await t.run(c=>c.db.insert('reelsDeliveries',{subject:'a',jobId:job,channelId:'t',platform:'tiktok',phase:'queued',dueAt,attempts:0,updatedAt:1}));
 for(const phase of ['queued','leased','sending','accepted','uncertain'] as const){await t.run(c=>c.db.patch(delivery,{phase}));await expect(a.mutation(api.publishingCollections.save,{collection:{...collection,libraryVideos:[]},expectedVersion:1})).rejects.toThrow('ألغِ موعد');}
 await t.run(c=>c.db.patch(delivery,{phase:'queued'}));await a.mutation(api.reelsJobs.cancel,{id:job});
 await a.mutation(api.publishingCollections.save,{collection:{...collection,libraryVideos:[]},expectedVersion:1});
 expect((await a.query(api.publishingCollections.get,{id:collection.id}))?.libraryVideos).toEqual([]);
 expect((await t.run(c=>c.db.get(job)))?.cancelled).toBe(true);expect((await t.run(c=>c.db.get(delivery)))?.phase).toBe('cancelled');expect((await t.run(c=>c.db.get(assetId)))?.deletedAt).toBeUndefined();
 expect((await a.query(api.reelsBilling.state,{})).remaining).toBe(59);
});
