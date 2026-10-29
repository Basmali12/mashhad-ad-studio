import {it,expect,vi,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import schema from './schema';import {api,internal} from './_generated/api';
const modules=import.meta.glob('./**/*.{ts,js}'),secret=btoa('k'.repeat(32));
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks();});
async function setup(){
 const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now);
 for(const [k,v]of Object.entries({OWNER_SUBJECT:'owner',CLERK_JWT_ISSUER_DOMAIN:'https://fixture',CONVEX_SITE_URL:'https://fixture.convex.site',PUBLISHING_SAAS_ENABLED:'true',REELS_CUSTOMER_PERSONAL_ENABLED:'true',REELS_CUSTOMER_LIVE_START_AT:String(now),REELS_OWNER_PERSONAL_ENABLED:'true',REELS_OWNER_BUFFER_ACCOUNT_ID:'owner-buffer',REELS_LIVE_START_AT:String(now-1000),PUBLISHING_REAL_SEND_ENABLED:'true',REELS_RUNNER_ENABLED:'true',PUBLISHING_BUFFER_PERSONAL_TOKEN_KEY:secret,REELS_MEDIA_SIGNING_KEY:'s'.repeat(40),REELS_MEDIA_ORIGIN:'https://media.fixture',BUNNY_STORAGE_ZONE:'fixture'}))vi.stubEnv(k,v);
 const t=convexTest(schema,modules),owner=t.withIdentity({subject:'owner',issuer:'https://fixture'}),a=t.withIdentity({subject:'alice',issuer:'https://fixture'}),b=t.withIdentity({subject:'bob',issuer:'https://fixture'});for(const u of[owner,a,b])await u.mutation(api.publishingUsers.register,{});
 const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>{const who=(init?.headers as Record<string,string>).Authorization.endsWith('alice')?'alice':'bob',query=JSON.parse(String(init?.body)).query;return Response.json({data:query.includes('organizations')?{account:{id:'buffer-'+who,organizations:[{id:'org-'+who}]}}:{channels:[{id:'channel-'+who,name:who,service:'youtube',organizationId:'org-'+who,type:'channel',isDisconnected:false,isLocked:false}]}});});vi.stubGlobal('fetch',fetcher);
 return {t,owner,a,b,now,fetcher};
}
it('requires admin activation before hosted key linking, locks it, and sends only customer-owned credentials',async()=>{
 const {t,owner,a,b,now,fetcher}=await setup();
 await expect(a.action(api.publishingBufferPersonal.connect,{key:'private-fixture-alice'})).rejects.toThrow('اشتراك');expect(fetcher).not.toHaveBeenCalled();
 for(const subject of['alice','bob'])await owner.mutation(api.reelsBilling.assign,{subject,planCode:'reels-60-4',platforms:['tiktok','facebook','instagram','youtube']});
 await a.action(api.publishingBufferPersonal.connect,{key:'private-fixture-alice'});await b.action(api.publishingBufferPersonal.connect,{key:'private-fixture-bob'});
 expect(await a.query(api.publishingBufferPersonal.state,{})).toMatchObject({configured:true,locked:true,commercialEnabled:true,publishingEnabled:true,selectedChannelIds:['channel-alice']});
 await expect(a.action(api.publishingBufferPersonal.connect,{key:'private-fixture-bob'})).rejects.toThrow('الدعم');await expect(b.mutation(api.publishingBufferPersonal.select,{ids:['channel-alice']})).rejects.toThrow();
 await t.run(c=>c.db.insert('mediaAssets',{subject:'alice',key:'asset',zone:'fixture',objectPath:'media/alice/asset.mp4',sha256:'a'.repeat(64),size:10,type:'video/mp4',createdAt:now,verifiedAt:now}));
 const dueAt=now+120000,collection={id:'folder',name:'F',libraryVideos:[{id:'video',title:'Title',createdAt:now,bunnyAssetId:'asset',publishAt:new Date(dueAt).toISOString(),metadataReviewed:true,channelIds:['channel-alice'],metadata:{title:'Title',description:'Description',hashtags:[],categoryId:'22',madeForKids:false,privacy:'private' as const,isAiGenerated:false}}]};
 await a.mutation(api.publishingCollections.save,{collection,expectedVersion:0});const [job]=await a.query(api.reelsJobs.list,{});expect(job.reviewRequired).not.toBe(true);expect(job.deliveries[0].phase).toBe('queued');expect(await b.query(api.reelsJobs.list,{})).toEqual([]);
 await expect(b.mutation(api.reelsJobs.cancel,{id:job._id})).rejects.toThrow('لا تخص');const claim=(await t.mutation(internal.reelsJobs.claim,{workerId:'fixture'}))!;expect(claim).not.toBeNull();
 const credentials=await t.action(internal.reelsWorker.credentials,claim);expect(credentials.token).toBe('private-fixture-alice');expect(credentials.token).not.toBe('private-fixture-bob');expect(fetcher).toHaveBeenCalledTimes(4);
 const sub=(await a.query(api.reelsBilling.state,{})).active!;await t.run(c=>c.db.patch(sub._id,{expiresAt:now}));await expect(t.mutation(internal.reelsJobs.intent,claim)).rejects.toThrow('منتهي');expect((await a.query(api.publishingBufferPersonal.state,{})).locked).toBe(true);
});
it('rejects channels outside the activated package without locking a failed initial connection',async()=>{
 const {owner,a,fetcher}=await setup();await owner.mutation(api.reelsBilling.assign,{subject:'alice',planCode:'reels-15-3',platforms:['tiktok','facebook','instagram']});
 await expect(a.action(api.publishingBufferPersonal.connect,{key:'private-fixture-alice'})).rejects.toThrow('خارج الباقة');const state=await a.query(api.publishingBufferPersonal.state,{});expect(state.locked).toBe(false);expect(state.connected).toBe(false);expect(fetcher).toHaveBeenCalledTimes(2);
});
