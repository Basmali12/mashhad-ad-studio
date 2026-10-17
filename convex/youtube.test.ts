import {it,expect,vi,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import {api,internal} from './_generated/api';
import schema from './schema';
const modules=import.meta.glob('./**/*.{ts,js}');
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
function setup(){for(const [name,value] of Object.entries({OWNER_SUBJECT:'owner',CLERK_JWT_ISSUER_DOMAIN:'https://fixture.clerk',YOUTUBE_CLIENT_ID:'client',YOUTUBE_CLIENT_SECRET:'private-client-secret',META_TOKEN_KEY:btoa('k'.repeat(32)),CONVEX_SITE_URL:'https://fixture.convex.site',CLIENT_ORIGINS:'https://iraqaistudio.com'}))vi.stubEnv(name,value);const t=convexTest(schema,modules);return {t,u:t.withIdentity({subject:'owner',issuer:'https://fixture.clerk'})};}
it('allows only the owner to start YouTube OAuth and rejects arbitrary return origins',async()=>{
 const {t,u}=setup();await expect(t.action(api.youtube.begin,{origin:'https://iraqaistudio.com'})).rejects.toThrow();await expect(u.action(api.youtube.begin,{origin:'https://evil.test'})).rejects.toThrow();
 const url=new URL(await u.action(api.youtube.begin,{origin:'https://iraqaistudio.com'}));expect(url.hostname).toBe('accounts.google.com');expect(url.searchParams.get('code_challenge_method')).toBe('S256');expect(url.searchParams.get('scope')).toContain('youtube.upload');expect(url.href).not.toContain('private-client-secret');
});
it('consumes OAuth state once, saves encrypted tokens and exposes only channel metadata',async()=>{
 const {t,u}=setup(),url=new URL(await u.action(api.youtube.begin,{origin:'https://iraqaistudio.com'}));
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({access_token:'private-access',refresh_token:'private-refresh',expires_in:3600,scope:'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly'})).mockResolvedValueOnce(Response.json({items:[{id:'channel',snippet:{title:'قناتي',thumbnails:{default:{url:'https://cdn.example/youtube.jpg'}}}}]}));vi.stubGlobal('fetch',fetcher);
 const result=await t.action(internal.youtube.callback,{state:url.searchParams.get('state')!,code:'code'});expect(result).toContain('youtube=connected');
 const state=await u.query(api.youtube.state,{});expect(state.channel?.name).toBe('قناتي');expect(state.channel?.avatar).toBe('https://cdn.example/youtube.jpg');expect(JSON.stringify(state)).not.toContain('private-');
 const stored=await t.run(c=>c.db.query('youtubeConnections').first());expect(stored?.access).not.toContain('private-access');expect(stored?.refresh).not.toContain('private-refresh');
 expect(await t.action(internal.youtube.callback,{state:url.searchParams.get('state')!,code:'code'})).toContain('expired');expect(fetcher).toHaveBeenCalledTimes(2);
});
