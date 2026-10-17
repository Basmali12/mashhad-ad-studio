import {it,expect,vi,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import schema from './schema';
import {api} from './_generated/api';
const modules=import.meta.glob('./**/*.{ts,js}');
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it('allows only the pinned owner to call the public chat action and never exposes the provider key',async()=>{
 vi.stubEnv('OWNER_SUBJECT','owner');vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN','https://fixture.clerk');vi.stubEnv('OPENROUTER_API_KEY','private-test-key');
 const t=convexTest(schema,modules),request={projectId:'general',turnId:'turn',memory:{projectId:'general',contextMode:'general'},messages:[{role:'user',content:[{type:'input_text',text:'هلو، شلونك اليوم؟'}]}]};
 const answer={reply:'هلا',memorySummary:'تحية',imageRequest:null,imageDetails:null,ticket:null,conflict:null};
 const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(answer)}}]})));vi.stubGlobal('fetch',fetcher);
 await expect(t.action(api.studioChat.reply,{request})).rejects.toThrow();
 await expect(t.withIdentity({subject:'other',issuer:'https://fixture.clerk'}).action(api.studioChat.reply,{request})).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
 const result=await t.withIdentity({subject:'owner',issuer:'https://fixture.clerk',email:'basm1998ali@gmail.com'}).action(api.studioChat.reply,{request});
 expect(result.reply).toBe('هلا');expect(JSON.stringify(result)).not.toContain('private-test-key');
});
