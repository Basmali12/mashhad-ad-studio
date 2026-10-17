import {it,expect,vi,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import schema from './schema';
import {api,internal} from './_generated/api';
const modules=import.meta.glob('./**/*.{ts,js}');afterEach(()=>vi.unstubAllEnvs());
it('stores verified metadata idempotently, preserves originals and denies other accounts',async()=>{
 vi.stubEnv('OWNER_SUBJECT','owner');vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN','https://fixture.clerk');vi.stubEnv('BUNNY_STORAGE_ZONE','fixture');const ownerHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('owner')))).map(b=>b.toString(16).padStart(2,'0')).join('');const t=convexTest(schema,modules),u=t.withIdentity({subject:'owner',issuer:'https://fixture.clerk'}),hash='a'.repeat(64),a={subject:'owner',key:hash,sha256:hash,objectPath:'media/'+ownerHash+'/'+hash+'.mp4',size:24,type:'video/mp4'};
 const id=await t.mutation(internal.mediaAssets.recordVerified,a);expect(await t.mutation(internal.mediaAssets.recordVerified,a)).toBe(id);expect(await u.query(api.mediaAssets.state,{})).toHaveLength(1);await expect(t.withIdentity({subject:'other',issuer:'https://fixture.clerk'}).query(api.mediaAssets.state,{})).rejects.toThrow();expect(await t.run(c=>c.db.query('socialPosts').collect())).toHaveLength(0);
});
