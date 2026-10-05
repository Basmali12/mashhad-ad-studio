import {beforeEach,it,expect,vi} from 'vitest';
import {convexTest} from 'convex-test';
import schema from './schema';
import {api,internal} from './_generated/api';
import {defaultTemplate} from '../shared/pipeline';
const modules=import.meta.glob('./**/*.{ts,js}');
const issuer='https://multi.clerk.accounts.dev',a={subject:'customer-a',issuer},b={subject:'customer-b',issuer};
const option={model:'Omni Flash',actualModel:'Omni 1.1 Flash',seconds:10,resolution:'360p' as const,aspect:'9:16',cost:7};
const form={name:'اختبار عزل الحسابات',address:'غير مذكور',phone:'07701234567',products:'اختبار',prompt:'A cup of coffee in warm sunlight',instructions:'',model:option.model,aspect:option.aspect,duration:10,dialect:'العراقية'};
beforeEach(()=>{vi.stubEnv('OWNER_SUBJECT','legacy-owner');vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN',issuer);vi.stubEnv('FLOW_CONCURRENCY','2');});
async function setup(){const t=convexTest(schema,modules);await t.run(async ctx=>{for(const who of [a,b])await ctx.db.insert('pointWallets',{subject:who.subject,publicId:'MS-'+who.subject,name:who.subject,balance:50,enabled:true,models:[option.model],maxClips:10,createdAt:1,updatedAt:1});await ctx.db.insert('pointRates',{key:`${option.model}:360p:10`,model:option.model,resolution:'360p',seconds:10,points:7,updatedAt:1});});await t.mutation(internal.pipeline.presence,{workerId:'w',state:'online',options:[option],observedAt:Date.now()});return {t,alice:t.withIdentity(a),bob:t.withIdentity(b)};}
async function queued(user:ReturnType<ReturnType<typeof convexTest>['withIdentity']>,key:string){const requestId=await user.mutation(api.requests.save,{key,form,clipCount:1,referenceIds:[],submit:true});const jobId=await user.mutation(api.pipeline.authorize,{requestId,key:'generate-'+key,option,count:1,template:defaultTemplate(form)});return {requestId,jobId};}
it('isolates lists, branding, replay keys, job controls, exports and owner privileges',async()=>{
 const {alice,bob}=await setup(),job=await queued(alice,'alice-request');
 expect(await alice.query(api.access.customer)).toBe(true);expect(await alice.query(api.access.allowed)).toBe(false);
 expect(await bob.query(api.requests.list)).toHaveLength(0);
 await expect(bob.query(api.pipeline.state,{requestId:job.requestId})).rejects.toThrow('مصرح');
 await expect(bob.query(api.editing.state,{requestId:job.requestId})).rejects.toThrow('مصرح');
 for(const fn of [api.pipeline.stop,api.pipeline.resume])await expect(bob.mutation(fn,{jobId:job.jobId})).rejects.toThrow('مصرح');
 await expect(bob.mutation(api.requests.save,{key:'alice-request',form,clipCount:1,referenceIds:[],submit:true})).rejects.toThrow('مصرح');
 await expect(bob.mutation(api.pipeline.authorize,{requestId:job.requestId,key:'generate-alice-request',option,count:1,template:defaultTemplate(form)})).rejects.toThrow('مصرح');
 await alice.mutation(api.studio.saveBranding,{name:'متجر أ',address:'',phone:'0770',logoEnabled:false});expect(await bob.query(api.studio.branding)).toBeNull();
 await bob.mutation(api.studio.saveBranding,{name:'متجر ب',address:'',phone:'0771',logoEnabled:false});expect((await alice.query(api.studio.branding))?.name).toBe('متجر أ');
});
it('allows two different customers concurrently, fences duplicates, limits one lane per customer and charges each once',async()=>{
 const {t,alice,bob}=await setup(),ja=await queued(alice,'alice-request'),jb=await queued(bob,'bob-request'),ja2=await queued(alice,'alice-second');
 const ia={jobId:ja.jobId,workerId:'w',fence:'a'},ib={jobId:jb.jobId,workerId:'w',fence:'b'};
 await t.mutation(internal.pipeline.claim,ia);expect(await t.query(internal.pipeline.next,{})).toBe(jb.jobId);await t.mutation(internal.pipeline.claim,ib);
 expect(await t.query(internal.pipeline.next,{})).toBeNull();await expect(t.mutation(internal.pipeline.claim,{...ia,fence:'duplicate'})).rejects.toThrow();await expect(t.mutation(internal.pipeline.claim,{jobId:ja2.jobId,workerId:'w',fence:'a2'})).rejects.toThrow();
 await t.mutation(internal.pipeline.clip,{...ia,index:0,state:'intent',projectPath:'/project/alice'});await t.mutation(internal.pipeline.clip,{...ib,index:0,state:'intent',projectPath:'/project/bob'});
 await expect(t.mutation(internal.pipeline.clip,{...ia,index:0,state:'intent',projectPath:'/project/alice'})).rejects.toThrow();
 const wallets=await t.run(ctx=>ctx.db.query('pointWallets').collect());expect(wallets.map(w=>w.balance)).toEqual([43,43]);
 await t.mutation(internal.pipeline.release,ia);await alice.mutation(api.pipeline.stop,{jobId:ja.jobId});await alice.mutation(api.pipeline.resume,{jobId:ja.jobId});await t.mutation(internal.pipeline.claim,{...ia,fence:'resumed'});
 expect((await t.run(ctx=>ctx.db.get(ja.jobId)))?.clips[0].state).toBe('intent');expect(await t.run(ctx=>ctx.db.query('pointLedger').collect())).toHaveLength(2);
});
it('keeps capacity one by default and blocks disabled customers',async()=>{
 vi.stubEnv('FLOW_CONCURRENCY','1');const {t,alice,bob}=await setup(),ja=await queued(alice,'alice-request'),jb=await queued(bob,'bob-request');await t.mutation(internal.pipeline.claim,{jobId:ja.jobId,workerId:'w',fence:'a'});await expect(t.mutation(internal.pipeline.claim,{jobId:jb.jobId,workerId:'w',fence:'b'})).rejects.toThrow();
 await t.run(async ctx=>{const w=await ctx.db.query('pointWallets').withIndex('by_subject',q=>q.eq('subject',b.subject)).unique();await ctx.db.patch(w!._id,{enabled:false});});expect(await bob.query(api.access.customer)).toBe(false);await expect(bob.query(api.requests.list)).rejects.toThrow();
});
it('protects uploads, content-hash deduplication, continuation and authenticated file metadata',async()=>{
 const {t,alice,bob}=await setup(),bytes=new Uint8Array([137,80,78,71,13,10,26,10]),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join(''),key='image:'+hash;
 await alice.mutation(api.files.begin,{key,kind:'image',name:'a.png',type:'image/png',size:8});const id=await t.run(ctx=>ctx.storage.store(new Blob([bytes],{type:'image/png'})));await alice.action(api.files.finish,{key,storageId:id});
 expect((await alice.fetch(`/files?id=${id}&metadata=1`)).status).toBe(200);expect((await bob.fetch(`/files?id=${id}&metadata=1`)).status).toBe(404);
 await expect(bob.mutation(api.requests.save,{key:'stolen-image',form,clipCount:1,referenceIds:[id],submit:true})).rejects.toThrow('الملف');
 const ticket=await bob.mutation(api.files.begin,{key,kind:'image',name:'b.png',type:'image/png',size:8});expect(ticket.storageId).toBeNull();await expect(bob.action(api.files.finish,{key,storageId:id})).rejects.toThrow();
 const ja=await queued(alice,'alice-original'),video=await t.run(async ctx=>{const storageId=await ctx.storage.store(new Blob(['video fixture'],{type:'video/mp4'}));await ctx.db.insert('uploads',{key:'video:'+ 'a'.repeat(64),storageId,kind:'video',name:'a.mp4',type:'video/mp4',size:13,createdAt:1});await ctx.db.patch(ja.requestId,{results:[{storageId,assetId:'a',duration:10,width:360,height:640}]});return storageId;});
 expect((await bob.fetch(`/files?id=${video}&metadata=1`)).status).toBe(404);await expect(bob.mutation(api.requests.save,{key:'stolen-source',form:{...form,continuationSourceId:video},clipCount:1,referenceIds:[],submit:true})).rejects.toThrow('الملف');
});
