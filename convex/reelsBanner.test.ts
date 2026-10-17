import {it,expect,vi,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import schema from './schema';
import {api,internal} from './_generated/api';
const modules=import.meta.glob('./**/!(*.test).ts');
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers();});
async function setup(){vi.stubEnv('OWNER_SUBJECT','owner');vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN','https://fixture');vi.stubEnv('PUBLISHING_SAAS_ENABLED','true');vi.stubEnv('BUNNY_STORAGE_ZONE','fixture');const t=convexTest(schema,modules),owner=t.withIdentity({subject:'owner',issuer:'https://fixture'}),customer=t.withIdentity({subject:'customer',issuer:'https://fixture'});await owner.mutation(api.publishingUsers.register,{});await customer.mutation(api.publishingUsers.register,{});return {t,owner,customer};}
async function image(t:ReturnType<typeof convexTest>,subject='owner',hash='a'){return t.run(c=>c.db.insert('mediaAssets',{subject,key:hash.repeat(64),sha256:hash.repeat(64),zone:'fixture',objectPath:'fixture/banner.png',size:24,type:'image/png',verifiedAt:1,createdAt:1}));}
it('lets only the owner manage banner settings and upload image tickets, never customer image uploads',async()=>{
 const {t,owner,customer}=await setup();expect(await t.query(api.reelsBanner.active,{})).toBeNull();await expect(customer.query(api.reelsBanner.state,{})).rejects.toThrow();await expect(t.query(api.reelsBanner.state,{})).rejects.toThrow();
 await expect(customer.mutation(api.reelsBanner.prepareUpload,{size:24,type:'image/png'})).rejects.toThrow();await expect(customer.mutation(api.reelsBanner.save,{enabled:false,expectedRevision:null})).rejects.toThrow();
 for(const args of [{size:24,type:'image/svg+xml'},{size:2097153,type:'image/png'},{size:24,type:'video/mp4'}])await expect(owner.mutation(api.reelsBanner.prepareUpload,args)).rejects.toThrow();
 const sub=await owner.mutation(api.reelsBilling.assign,{subject:'customer',planCode:'reels-15-3',platforms:['facebook','instagram','tiktok']});expect(sub).toBeTruthy();await expect(customer.mutation(api.publishingUploadTickets.begin,{size:24,type:'image/png'})).rejects.toThrow('MP4');
});
it('uploads an owner banner without an active video subscription or video quota charge',async()=>{
 const {t,owner,customer}=await setup(),ticket=await owner.mutation(api.reelsBanner.prepareUpload,{size:24,type:'image/png'});
 expect(await owner.query(api.publishingUploadTickets.inspect,{id:ticket})).toMatchObject({purpose:'site-banner',type:'image/png'});await expect(customer.mutation(api.publishingUploadTickets.start,{id:ticket})).rejects.toThrow();
 const fence=await owner.mutation(api.publishingUploadTickets.start,{id:ticket});const sha='b'.repeat(64),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('owner')))).map(n=>n.toString(16).padStart(2,'0')).join('');
 const assetId=await t.mutation(internal.mediaAssets.recordVerified,{subject:'owner',key:sha,sha256:sha,objectPath:'media/'+hash+'/'+sha+'.png',size:24,type:'image/png',ticketId:ticket,ticketFence:fence});
 await owner.mutation(api.reelsBanner.save,{assetId,enabled:true,expectedRevision:null});expect(await t.run(c=>c.db.query('reelsUploadUsage').collect())).toEqual([]);expect(await t.run(c=>c.db.query('reelsSubscriptions').collect())).toEqual([]);
});
it('publishes only the selected advert, hides it safely and rejects stale revisions or another customer asset',async()=>{
 const {t,owner}=await setup(),assetId=await image(t),foreign=await image(t,'customer');await expect(owner.mutation(api.reelsBanner.save,{assetId:foreign,enabled:true,expectedRevision:null})).rejects.toThrow('الإدارة');await expect(owner.mutation(api.reelsBanner.save,{enabled:true,expectedRevision:null})).rejects.toThrow('أولاً');
 const revision=await owner.mutation(api.reelsBanner.save,{assetId,enabled:true,expectedRevision:null});expect(await t.query(api.reelsBanner.active,{})).toEqual({revision});expect((await t.query(internal.reelsBanner.asset,{revision})).type).toBe('image/png');
 await expect(t.query(internal.reelsBanner.asset,{revision:'arbitrary-asset'})).rejects.toThrow();await expect(owner.mutation(api.reelsBanner.save,{enabled:false,expectedRevision:null})).rejects.toThrow('جلسة');
 await owner.mutation(api.reelsBanner.save,{enabled:false,expectedRevision:revision});expect(await t.query(api.reelsBanner.active,{})).toBeNull();await expect(t.query(internal.reelsBanner.asset,{revision})).rejects.toThrow();expect((await t.run(c=>c.db.get(assetId)))?.deletedAt).toBeUndefined();expect(await t.run(c=>c.db.query('reelsAdminAudit').collect())).toHaveLength(2);
});
it('serializes simultaneous admin saves into a single approved configuration',async()=>{
 const {t,owner}=await setup(),assetId=await image(t),results=await Promise.allSettled([true,false].map(enabled=>owner.mutation(api.reelsBanner.save,{assetId,enabled,expectedRevision:null})));expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(await t.run(c=>c.db.query('reelsSiteBanner').collect())).toHaveLength(1);
});

it('commits the replacement before authorizing cleanup, fences races and removes only the retired record',async()=>{
 vi.useFakeTimers();const {t,owner}=await setup(),first=await image(t),second=await image(t,'owner','b');
 const rev=await owner.mutation(api.reelsBanner.save,{assetId:first,enabled:true,expectedRevision:null});
 await expect(owner.mutation(api.reelsBanner.save,{assetId:second,enabled:true,expectedRevision:'stale'})).rejects.toThrow();expect((await t.run(c=>c.db.get(first)))?.deletionPending).toBeUndefined();
 const next=await owner.mutation(api.reelsBanner.save,{assetId:second,enabled:true,expectedRevision:rev}),old=await t.run(c=>c.db.get(first));expect(old?.deletionPending).toBe(true);expect((await t.query(api.reelsBanner.active,{}))?.revision).toBe(next);
 await expect(owner.mutation(api.reelsBanner.save,{assetId:first,enabled:true,expectedRevision:next})).rejects.toThrow();
 await expect(t.query(internal.reelsBanner.retiredAsset,{assetId:second,fence:old!.retentionFence!})).rejects.toThrow();await expect(t.query(internal.reelsBanner.retiredAsset,{assetId:first,fence:'wrong'})).rejects.toThrow();
 expect(await t.query(internal.reelsBanner.retiredAsset,{assetId:first,fence:old!.retentionFence!})).toMatchObject({type:'image/png',verified:true});
 await t.mutation(internal.reelsBanner.retiredCompleted,{assetId:first,fence:old!.retentionFence!});expect(await t.run(c=>c.db.get(first))).toBeNull();expect(await t.run(c=>c.db.get(second))).not.toBeNull();
});
