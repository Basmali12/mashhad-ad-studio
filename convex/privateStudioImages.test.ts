import {it,expect,vi,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import {anyApi} from 'convex/server';
import schema from './schema';
const modules=import.meta.glob('./**/*.{ts,js}');
afterEach(()=>vi.unstubAllEnvs());
async function fixture(cost=0){
 const owner={subject:'owner',issuer:'https://owner.clerk.accounts.dev'};
 for(const [key,value]of Object.entries({OWNER_SUBJECT:owner.subject,CLERK_JWT_ISSUER_DOMAIN:owner.issuer,OWNER_PERSONAL_FLOW_ENABLED:'true',OWNER_PERSONAL_FLOW_FREE_POINTS_ENABLED:'true',CUSTOMER_ACCESS_DISABLED:'true'}))vi.stubEnv(key,value);
 const t=convexTest(schema,modules),u=t.withIdentity(owner);
 await t.run(async c=>{await c.db.insert('workers',{key:'pipeline',workerId:'w',state:'online',seenAt:Date.now(),observedAt:Date.now(),options:[],imageOptions:[{model:'Nano Banana 2 Lite',aspect:'1:1',cost}],imageObservedAt:Date.now()});await c.db.insert('pointWallets',{subject:'owner',publicId:'owner',name:'owner',balance:0,enabled:true,models:[],maxClips:1,createdAt:1,updatedAt:1});});return {t,u,owner};
}
it('keeps public entry closed while authorizing only owner free images idempotently',async()=>{
 const {t,u,owner}=await fixture();const args={key:'private-image-1',prompt:'Iraqi character'};
 const id=await u.mutation(anyApi.privateStudioImages.authorize,args);expect(await u.mutation(anyApi.privateStudioImages.authorize,args)).toBe(id);
 expect(await t.run(c=>c.db.get(id))).toMatchObject({points:0,ownerFlow:true,personalFlow:true});
 await expect(u.mutation(anyApi.images.authorize,{...args,referenceIds:[],option:{model:'Nano Banana 2 Lite',aspect:'1:1',cost:0}})).rejects.toThrow();
 await expect(t.withIdentity({...owner,subject:'another'}).query(anyApi.privateStudioImages.status,{jobId:id})).rejects.toThrow();
});
it('refuses a paid Lite option and stale connection',async()=>{
 const {u}=await fixture(1);await expect(u.mutation(anyApi.privateStudioImages.authorize,{key:'private-paid-1',prompt:'portrait'})).rejects.toThrow('مدفوع');
 const {t,u:other}=await fixture();await t.run(async c=>{const w=await c.db.query('workers').first();await c.db.patch(w!._id,{seenAt:Date.now()-61000});});await expect(other.mutation(anyApi.privateStudioImages.authorize,{key:'private-stale-1',prompt:'portrait'})).rejects.toThrow('تحديث');
});
it('binds an uploaded edit reference to its owner before authorizing Flow',async()=>{
 const {t,u}=await fixture();
 const storageId=await t.run(async c=>{const id=await c.storage.store(new Blob(['reference'],{type:'image/jpeg'}));await c.db.insert('uploads',{key:'image:reference',subject:'owner',kind:'image',name:'reference.jpg',type:'image/jpeg',size:9,storageId:id,createdAt:1});return id;});
 const job=await u.mutation(anyApi.privateStudioImages.authorize,{key:'uploaded-edit-1',prompt:'Add a third person',sourceStorageId:storageId});
 expect((await t.run(c=>c.db.get(job)))?.referenceIds).toEqual([storageId]);
 await t.run(async c=>{const row=await c.db.query('uploads').first();await c.db.patch(row!._id,{subject:'another'});});
 await expect(u.mutation(anyApi.privateStudioImages.authorize,{key:'uploaded-edit-2',prompt:'Edit',sourceStorageId:storageId})).rejects.toThrow();
});
it('reads and refreshes only owner Flow credits without touching legacy point balances',async()=>{
 const {t,u,owner}=await fixture();await u.mutation(anyApi.privateStudioImages.refreshBalance,{});
 expect(await u.query(anyApi.privateStudioImages.balance,{})).toMatchObject({pending:true,credits:null});
 await t.run(async c=>{const row=await c.db.query('flowBalances').first();await c.db.patch(row!._id,{credits:50,at:Date.now()+1});});
 expect(await u.query(anyApi.privateStudioImages.balance,{})).toMatchObject({credits:50,pending:false});
 await expect(t.withIdentity({...owner,subject:'another'}).query(anyApi.privateStudioImages.balance,{})).rejects.toThrow();
 expect(await t.run(c=>c.db.query('pointLedger').collect())).toHaveLength(0);
 expect((await t.run(c=>c.db.query('pointWallets').first()))?.balance).toBe(0);
});
