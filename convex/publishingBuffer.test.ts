import {it,expect,vi,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import schema from './schema';
import {api,internal} from './_generated/api';
import {sealToken,openToken,stateHash} from '../shared/meta';
const modules=import.meta.glob('./**/*.{ts,js}'),key=btoa('k'.repeat(32));afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
async function setup(){
 vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN','https://fixture.clerk');vi.stubEnv('OWNER_SUBJECT','owner');vi.stubEnv('PUBLISHING_SAAS_ENABLED','true');vi.stubEnv('PUBLISHING_BUFFER_OAUTH_ENABLED','true');vi.stubEnv('PUBLISHING_BUFFER_CLIENT_ID','test-client');vi.stubEnv('PUBLISHING_BUFFER_CLIENT_SECRET','fixture-secret');vi.stubEnv('PUBLISHING_BUFFER_TOKEN_KEY',key);vi.stubEnv('PUBLISHING_BUFFER_REDIRECT_URI','https://localhost:43147/publishing-buffer/callback');vi.stubEnv('PUBLISHING_BUFFER_ORIGINS','https://localhost:43147');
 const t=convexTest(schema,modules),a=t.withIdentity({subject:'a',issuer:'https://fixture.clerk'}),b=t.withIdentity({subject:'b',issuer:'https://fixture.clerk'});await a.mutation(api.publishingUsers.register,{});await b.mutation(api.publishingUsers.register,{});await t.run(async c=>{for(const subject of ['a','b'])await c.db.insert('reelsSubscriptions',{subject,planCode:'fixture',startsAt:0,expiresAt:Date.now()+30*86400000,videoLimit:60,platformLimit:1,platforms:['youtube'],enabled:true});});return {t,a,b};
}
function channel(id:string){return {id,name:id,service:'youtube',organizationId:'org',type:'channel',isDisconnected:false,isLocked:false};}
it('issues least-scope PKCE, encrypted verifier, exact HTTPS redirect; rejects other origins and replay',async()=>{
 const {t,a,b}=await setup(),url=new URL(await a.action(api.publishingBuffer.begin,{origin:'https://localhost:43147'}));expect(url.origin).toBe('https://auth.buffer.com');expect(url.searchParams.get('scope')).toBe('account:read posts:read posts:write offline_access');expect(url.searchParams.get('code_challenge_method')).toBe('S256');
 const rows=await t.run(c=>c.db.query('publishingBufferAuth').collect());expect(rows).toHaveLength(1);expect(rows[0].subject).toBe('a');expect(url.href).not.toContain(rows[0].verifier);await expect(openToken(rows[0].verifier,key,'b')).rejects.toThrow();
 await expect(b.action(api.publishingBuffer.begin,{origin:'https://attacker.example'})).rejects.toThrow('غير مسموح');
 const hash=await stateHash(url.searchParams.get('state')!);expect(await t.mutation(internal.publishingBuffer.takeAuth,{hash})).not.toBeNull();expect(await t.mutation(internal.publishingBuffer.takeAuth,{hash})).toBeNull();
});
it('completes two simulated OAuth callbacks and isolates tokens, channel selection and cancellation',async()=>{
 const {t,a,b}=await setup();let current='a';vi.stubGlobal('fetch',vi.fn(async(url:unknown,init?:RequestInit)=>{
 if(String(url).endsWith('/token'))return Response.json({access_token:'access-'+current,refresh_token:'refresh-'+current,expires_in:3600,scope:'account:read posts:read posts:write offline_access'});
 const token=(init?.headers as Record<string,string>).Authorization,subject=token.endsWith('a')?'a':'b',body=JSON.parse(String(init?.body));return Response.json({data:body.query.includes('organizations')?{account:{id:'account-'+subject,organizations:[{id:'org'}]}}:{channels:[channel('channel-'+subject)]}},{headers:{RateLimit:'"100-in-15min";r=98;t=800'}});
 }));
 for(const [u,s] of [[a,'a'],[b,'b']] as const){current=s;const url=new URL(await u.action(api.publishingBuffer.begin,{origin:'https://localhost:43147'}));expect(await t.action(internal.publishingBuffer.callback,{state:url.searchParams.get('state')!,code:'fixture-code'})).toBe('https://localhost:43147/?buffer=connected');}
 const sa=await a.query(api.publishingBuffer.state,{}),sb=await b.query(api.publishingBuffer.state,{});expect(sa.channels.map(c=>c.id)).toEqual(['channel-a']);expect(sb.channels.map(c=>c.id)).toEqual(['channel-b']);expect(JSON.stringify(sa)).not.toContain('access-a');expect(sa.quota?.sharedAcrossCustomers).toBe(true);
 await expect(b.mutation(api.publishingBuffer.select,{ids:['channel-a']})).rejects.toThrow('حسابك');await a.mutation(api.publishingBuffer.select,{ids:['channel-a']});await expect(b.mutation(api.publishingBuffer.disconnect,{})).rejects.toThrow('الدعم');expect((await a.query(api.publishingBuffer.state,{})).connected).toBe(true);expect((await b.query(api.publishingBuffer.state,{})).connected).toBe(true);
 expect(await t.run(c=>c.db.query('bufferConnections').collect())).toHaveLength(0);expect(await t.run(c=>c.db.query('socialAccounts').collect())).toHaveLength(0);
});
it('rejects expired state and partial grants without network replay or credential disclosure',async()=>{
 const {t,a}=await setup(),fetcher=vi.fn(async()=>Response.json({access_token:'secret-reflection',refresh_token:'refresh',expires_in:3600,scope:'account:read'}));vi.stubGlobal('fetch',fetcher);
 const url=new URL(await a.action(api.publishingBuffer.begin,{origin:'https://localhost:43147'})),state=url.searchParams.get('state')!;expect(await t.action(internal.publishingBuffer.callback,{state,code:'code'})).toBe('https://localhost:43147/?buffer=failed');expect((await a.query(api.publishingBuffer.state,{})).connected).toBe(false);expect(await t.action(internal.publishingBuffer.callback,{state,code:'code'})).toBeNull();expect(fetcher).toHaveBeenCalledTimes(1);
 const next=new URL(await a.action(api.publishingBuffer.begin,{origin:'https://localhost:43147'}));await t.run(async c=>{const row=await c.db.query('publishingBufferAuth').unique();await c.db.patch(row!._id,{expiresAt:0});});expect(await t.action(internal.publishingBuffer.callback,{state:next.searchParams.get('state')!,code:'code'})).toBeNull();expect(fetcher).toHaveBeenCalledTimes(1);
});
it('serializes refresh rotation and stops on ambiguous failure without retrying a single-use token',async()=>{
 const {t}=await setup();await t.mutation(internal.publishingBuffer.save,{subject:'a',clientId:'test-client',accountId:'account',access:await sealToken('old-access',key,'a'),refresh:await sealToken('old-refresh',key,'a'),expires:0,scopes:['account:read','posts:read','posts:write','offline_access'],channels:[channel('a')]});
 const row=await t.query(internal.publishingBuffer.connection,{subject:'a'});expect(await t.mutation(internal.publishingBuffer.lock,{subject:'a',revision:row!.revision,fence:'first'})).toBe(true);expect(await t.mutation(internal.publishingBuffer.lock,{subject:'a',revision:row!.revision,fence:'second'})).toBe(false);
 await t.mutation(internal.publishingBuffer.finishRefresh,{subject:'a',revision:row!.revision,fence:'first',access:await sealToken('rotated',key,'a'),refresh:await sealToken('rotated-refresh',key,'a'),expires:0});const fetcher=vi.fn(async()=>{throw Error('ambiguous private network response');});vi.stubGlobal('fetch',fetcher);
 await expect(t.action(internal.publishingBuffer.accessToken,{subject:'a'})).rejects.toThrow('أعد الربط');await expect(t.action(internal.publishingBuffer.accessToken,{subject:'a'})).rejects.toThrow('أعد ربط');expect(fetcher).toHaveBeenCalledTimes(1);expect((await t.query(internal.publishingBuffer.connection,{subject:'a'}))?.needsReconnect).toBe(true);
});
it('rejects shared provider account and disabled users; stays closed without staging configuration',async()=>{
 const {t,a,b}=await setup(),values={clientId:'test-client',accountId:'same',access:await sealToken('access',key,'a'),refresh:await sealToken('refresh',key,'a'),expires:1,scopes:[],channels:[channel('same-channel')]};await t.mutation(internal.publishingBuffer.save,{...values,subject:'a'});await expect(t.mutation(internal.publishingBuffer.save,{...values,subject:'b'})).rejects.toThrow('مستخدم آخر');
 await t.run(async c=>{const user=await c.db.query('publishingUsers').withIndex('by_subject',q=>q.eq('subject','b')).unique();await c.db.patch(user!._id,{disabled:true});});await expect(b.query(api.publishingBuffer.state,{})).rejects.toThrow('غير مفعّل');
 vi.stubEnv('PUBLISHING_BUFFER_OAUTH_ENABLED','false');expect((await a.query(api.publishingBuffer.state,{})).configured).toBe(false);await expect(a.action(api.publishingBuffer.begin,{origin:'https://localhost:43147'})).rejects.toThrow('ينتظر');
});

