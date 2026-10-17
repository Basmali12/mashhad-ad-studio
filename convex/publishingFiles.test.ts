import {it,expect,vi,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import schema from './schema';
import {api} from './_generated/api';
const modules=import.meta.glob('./**/*.{ts,js}');
afterEach(()=>vi.unstubAllEnvs());
it('uploads and verifies an original MP4 without any wallet, worker or Flow session; rejects other owners',async()=>{
 vi.stubEnv('OWNER_SUBJECT','owner');vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN','https://fixture.clerk');
 const t=convexTest(schema,modules),u=t.withIdentity({subject:'owner',issuer:'https://fixture.clerk'}),bytes=new Uint8Array([0,0,0,24,102,116,121,112,105,115,111,109,0,0,0,0,105,115,111,109,109,112,52,50]);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join(''),key='video:'+hash;
 await u.mutation(api.publishingFiles.begin,{key,name:'original.mp4',size:bytes.length,type:'video/mp4'});const storageId=await t.run(c=>c.storage.store(new Blob([bytes],{type:'video/mp4'})));
 expect(await u.action(api.publishingFiles.finish,{key,storageId})).toBe(storageId);expect((await u.query(api.publishingFiles.descriptor,{storageId})).storageId).toBe(storageId);
 expect(await t.run(c=>c.db.query('workers').collect())).toHaveLength(0);expect(await t.run(c=>c.db.query('pointWallets').collect())).toHaveLength(0);
 await expect(t.withIdentity({subject:'other',issuer:'https://fixture.clerk'}).query(api.publishingFiles.descriptor,{storageId})).rejects.toThrow();
 expect((await u.mutation(api.publishingFiles.begin,{key,name:'original.mp4',size:bytes.length,type:'video/mp4'})).storageId).toBe(storageId);
});
it('rejects a hash mismatch and keeps historical files intact',async()=>{
 vi.stubEnv('OWNER_SUBJECT','owner');vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN','https://fixture.clerk');const t=convexTest(schema,modules),u=t.withIdentity({subject:'owner',issuer:'https://fixture.clerk'}),bytes=new TextEncoder().encode('\u0000\u0000\u0000\u0018ftypisom\u0000\u0000\u0000\u0000isommp42'),key='video:'+'a'.repeat(64);
 await u.mutation(api.publishingFiles.begin,{key,name:'v.mp4',size:bytes.length,type:'video/mp4'});const storageId=await t.run(c=>c.storage.store(new Blob([bytes],{type:'video/mp4'})));await expect(u.action(api.publishingFiles.finish,{key,storageId})).rejects.toThrow('بصمة');expect(await t.run(async c=>(await c.storage.get(storageId))?.size)).toBe(bytes.length);
});
