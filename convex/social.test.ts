import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {convexTest} from 'convex-test';
import schema from './schema';
import {api,internal} from './_generated/api';
const modules=import.meta.glob('./**/*.{ts,js}'),owner={subject:'owner',issuer:'https://owner.clerk.accounts.dev'};
beforeEach(()=>{vi.stubEnv('OWNER_SUBJECT',owner.subject);vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN',owner.issuer)});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals()});
async function setup(){const t=convexTest(schema,modules),u=t.withIdentity(owner);const accountId=await t.run(ctx=>ctx.db.insert('socialAccounts',{subject:owner.subject,platform:'facebook',providerUserId:'123',accountId:'456',pageId:'456',name:'Test Page',token:'encrypted-fixture',selected:true,connectedAt:Date.now()}));const storageId=await t.run(async ctx=>{const storageId=await ctx.storage.store(new Blob(['fixture'],{type:'video/mp4'}));await ctx.db.insert('uploads',{subject:owner.subject,key:'video:'+ 'a'.repeat(64),kind:'video',name:'fixture.mp4',type:'video/mp4',size:7,createdAt:Date.now(),storageId});return storageId});return {t,u,accountId,storageId};}
it('keeps all authorized accounts visible and saves Facebook and Instagram choices independently',async()=>{
 const {t,u,accountId}=await setup();const [second,instagram]=await t.run(async c=>Promise.all([c.db.insert('socialAccounts',{subject:'owner',platform:'facebook',providerUserId:'123',accountId:'789',pageId:'789',name:'Second Page',token:'secret-two',selected:false,connectedAt:1}),c.db.insert('socialAccounts',{subject:'owner',platform:'instagram',providerUserId:'123',accountId:'ig',pageId:'789',name:'Instagram',token:'secret-ig',selected:true,connectedAt:1})]));
 await u.mutation(api.social.select,{id:second});const state=await u.query(api.social.state,{});expect(state.accounts).toHaveLength(3);expect(state.accounts.find(a=>a._id===second)?.selected).toBe(true);expect(state.accounts.find(a=>a._id===accountId)?.selected).toBe(false);expect(state.accounts.find(a=>a._id===instagram)?.selected).toBe(true);expect(JSON.stringify(state)).not.toContain('secret-');
});
it('hides credentials and enforces account and video ownership',async()=>{const d=await setup(),state=await d.u.query(api.social.state,{});expect(JSON.stringify(state)).not.toContain('encrypted-fixture');expect(state.accounts[0].name).toBe('Test Page');await expect(d.t.query(api.social.state,{})).rejects.toThrow();const other=await d.t.run(ctx=>ctx.db.insert('socialAccounts',{subject:'other',platform:'facebook',providerUserId:'555',accountId:'777',pageId:'777',name:'Other',token:'private',selected:true,connectedAt:Date.now()}));await expect(d.u.mutation(api.social.select,{id:other})).rejects.toThrow();await expect(d.u.mutation(internal.social.claim,{key:'a'.repeat(32),accountId:other,storageId:d.storageId,caption:'hello'})).rejects.toThrow();await d.t.run(async ctx=>{const file=await ctx.db.query('uploads').withIndex('by_storage',q=>q.eq('storageId',d.storageId)).unique();await ctx.db.patch(file!._id,{subject:'other'})});await expect(d.u.mutation(internal.social.claim,{key:'a'.repeat(32),accountId:d.accountId,storageId:d.storageId,caption:'hello'})).rejects.toThrow();});
it('accepts each immutable idempotency key once and prevents parallel publication',async()=>{const d=await setup(),input={key:'b'.repeat(32),accountId:d.accountId,storageId:d.storageId,caption:'hello'},first=await d.u.mutation(internal.social.claim,input),second=await d.u.mutation(internal.social.claim,input);expect(first.created).toBe(true);expect(second).toEqual({id:first.id,created:false});await expect(d.u.mutation(internal.social.claim,{...input,caption:'changed'})).rejects.toThrow();await expect(d.u.mutation(internal.social.claim,{...input,key:'c'.repeat(32)})).rejects.toThrow();expect(await d.t.mutation(internal.social.phase,{id:first.id,expected:'preparing',stage:'publishing'})).toBe(true);expect(await d.t.mutation(internal.social.phase,{id:first.id,expected:'preparing',stage:'publishing'})).toBe(false);});
it('consumes OAuth state once and rejects expired state',async()=>{const d=await setup();await d.t.mutation(internal.social.authStore,{subject:owner.subject,platform:'facebook',stateHash:'hashed-fixture',returnOrigin:'https://iraqaistudio.com'});expect(await d.t.mutation(internal.social.authTake,{hash:'hashed-fixture'})).toMatchObject({subject:owner.subject});expect(await d.t.mutation(internal.social.authTake,{hash:'hashed-fixture'})).toBe(null);await d.t.run(ctx=>ctx.db.insert('socialAuth',{subject:owner.subject,platform:'instagram',stateHash:'expired',returnOrigin:'https://iraqaistudio.com',expiresAt:Date.now()-1}));expect(await d.t.mutation(internal.social.authTake,{hash:'expired'})).toBe(null);});
it('deletes only the requesting Meta user linkage without deleting generated videos',async()=>{const d=await setup();await d.t.run(ctx=>ctx.db.insert('socialAccounts',{subject:'other',platform:'facebook',providerUserId:'999',accountId:'888',pageId:'888',name:'Other',token:'private',selected:true,connectedAt:Date.now()}));await d.t.mutation(internal.social.erase,{providerUserId:'123'});expect(await d.u.query(api.social.state,{})).toMatchObject({accounts:[]});expect(await d.t.run(ctx=>ctx.db.query('socialAccounts').collect())).toHaveLength(1);expect(await d.t.run(async ctx=>!!await ctx.storage.get(d.storageId))).toBe(true);});

it('reports deletion completion only for issued receipts',async()=>{const d=await setup();expect(await d.t.query(internal.social.receiptExists,{code:'unknown'})).toBe(false);await d.t.mutation(internal.social.receipt,{code:'issued'});expect(await d.t.query(internal.social.receiptExists,{code:'issued'})).toBe(true);});
it('updates only the current owner linkage photo without changing the publishing selection or exposing a token',async()=>{
 const {t,u,accountId}=await setup();
 await t.mutation(internal.social.saveProfile,{subject:'other',id:accountId,token:'encrypted-fixture',avatar:'https://cdn.example/wrong.jpg'});
 expect((await u.query(api.social.state,{})).accounts[0].avatar).toBeUndefined();
 await t.mutation(internal.social.saveProfile,{subject:'owner',id:accountId,token:'old-token',avatar:'https://cdn.example/stale.jpg'});
 expect((await u.query(api.social.state,{})).accounts[0].avatar).toBeUndefined();
 await t.mutation(internal.social.saveProfile,{subject:'owner',id:accountId,token:'encrypted-fixture',avatar:'https://cdn.example/profile.jpg'});
 const state=await u.query(api.social.state,{});expect(state.accounts[0]).toMatchObject({selected:true,name:'Test Page',avatar:'https://cdn.example/profile.jpg'});expect(JSON.stringify(state)).not.toContain('encrypted-fixture');
});

it.each([
  {pages:[],granted:true,reason:'no_pages'},
  {pages:[],granted:false,reason:'pages_permission_missing'},
  {pages:[{id:'456',name:'Fixture',access_token:'fixture-page-token',tasks:['ANALYZE']}],granted:true,reason:'no_publish_access'},
])('diagnoses $reason without returning credentials',async({pages,granted,reason})=>{
  const d=await setup();
  for(const [name,value] of Object.entries({META_APP_ID:'fixture-app',META_APP_SECRET:'fixture-secret',META_TOKEN_KEY:btoa('k'.repeat(32)),META_LOGIN_CONFIG_ID:'fixture-config',META_GRAPH_VERSION:'v26.0',CONVEX_SITE_URL:'https://fixture.convex.site'}))vi.stubEnv(name,value);
  vi.stubGlobal('fetch',vi.fn(async(input:string|URL)=>{
    const url=String(input);
    const body=url.includes('/oauth/access_token')?{access_token:'fixture-user-token'}:url.includes('/me/accounts')?{data:pages}:url.includes('/me/permissions')?{data:[{permission:'pages_show_list',status:granted?'granted':'declined'}]}:{id:'123'};
    return new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
  }));
  const {stateHash}=await import('../shared/meta');
  await d.t.mutation(internal.social.authStore,{subject:owner.subject,platform:'facebook',stateHash:await stateHash('fixture-state'),returnOrigin:'https://iraqaistudio.com'});
  const result=await d.t.action(internal.social.callback,{state:'fixture-state',code:'fixture-code'});
  expect(new URL(result).searchParams.get('social_reason')).toBe(reason);
  expect(result).not.toContain('token');expect(result).not.toContain('secret');
});
