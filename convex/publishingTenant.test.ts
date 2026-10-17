import {it,expect,vi,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import schema from './schema';
import {api,internal} from './_generated/api';
const modules=import.meta.glob('./**/*.{ts,js}');afterEach(()=>vi.unstubAllEnvs());
function environment(){vi.stubEnv('OWNER_SUBJECT','owner');vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN','https://fixture.clerk');vi.stubEnv('PUBLISHING_SAAS_ENABLED','true');vi.stubEnv('BUNNY_STORAGE_ZONE','fixture');}
it('isolates two member accounts with identical collection IDs; roles cannot come from the client',async()=>{
 environment();const t=convexTest(schema,modules),a=t.withIdentity({subject:'customer-a',issuer:'https://fixture.clerk'}),b=t.withIdentity({subject:'customer-b',issuer:'https://fixture.clerk'});
 await a.mutation(api.publishingUsers.register,{});await b.mutation(api.publishingUsers.register,{});expect((await a.query(api.publishingUsers.profile,{})).role).toBe('customer');
 const first=await a.mutation(api.publishingCollections.save,{collection:{id:'__general',name:'A',libraryVideos:[]},expectedVersion:0});await b.mutation(api.publishingCollections.save,{collection:{id:'__general',name:'B',libraryVideos:[]},expectedVersion:0});
 expect((await a.query(api.publishingCollections.list,{})).map(p=>p.name)).toEqual(['A']);expect((await b.query(api.publishingCollections.list,{})).map(p=>p.name)).toEqual(['B']);
 await expect(a.mutation(api.publishingCollections.save,{collection:{id:first.id,name:'stale'},expectedVersion:0})).rejects.toThrow('جهاز آخر');expect((await b.query(api.publishingCollections.get,{id:first.id}))?.name).toBe('B');
 await expect(t.withIdentity({subject:'customer-a',issuer:'https://attacker.example'}).query(api.publishingCollections.list,{})).rejects.toThrow('سجّل');await expect(t.query(api.publishingCollections.list,{})).rejects.toThrow('سجّل');
 expect(await t.run(c=>c.db.query('pointWallets').collect())).toHaveLength(0);expect(await t.run(c=>c.db.query('libraryPublications').collect())).toHaveLength(0);
});
it('binds upload tickets and file references to the authenticated member, including equal hashes',async()=>{
 environment();const t=convexTest(schema,modules),a=t.withIdentity({subject:'a',issuer:'https://fixture.clerk'}),b=t.withIdentity({subject:'b',issuer:'https://fixture.clerk'});await a.mutation(api.publishingUsers.register,{});await b.mutation(api.publishingUsers.register,{});
 await t.run(c=>c.db.insert('reelsSubscriptions',{subject:'a',planCode:'fixture',startsAt:Date.now(),expiresAt:Date.now()+30*86400000,videoLimit:60,platformLimit:3,platforms:['facebook','instagram','tiktok'],enabled:true}));const ticket=await a.mutation(api.publishingUploadTickets.begin,{size:24,type:'video/mp4'});await expect(b.query(api.publishingUploadTickets.inspect,{id:ticket})).rejects.toThrow('لا يخص');const hash='a'.repeat(64),ownerHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('a')))).map(n=>n.toString(16).padStart(2,'0')).join('');
 await t.mutation(internal.mediaAssets.recordVerified,{subject:'a',key:hash,sha256:hash,objectPath:'media/'+ownerHash+'/'+hash+'.mp4',size:24,type:'video/mp4',ticketId:ticket});
 expect(await b.query(api.mediaAssets.state,{})).toHaveLength(0);await expect(b.mutation(api.publishingCollections.save,{collection:{id:'folder',name:'B',libraryVideos:[{id:'video',title:'v',createdAt:1,bunnyAssetId:hash,publishAt:''}]},expectedVersion:0})).rejects.toThrow('لا تخص');
 await expect(a.mutation(api.publishingCollections.save,{collection:{id:'folder',name:'A',libraryVideos:[{id:'video',title:'v',createdAt:1,bunnyAssetId:hash,publishAt:'',publishedAt:new Date().toISOString()}]},expectedVersion:0})).rejects.toThrow('محرك النشر');
 await expect(t.mutation(internal.mediaAssets.recordVerified,{subject:'b',key:hash,sha256:hash,objectPath:'media/'+ownerHash+'/'+hash+'.mp4',size:24,type:'video/mp4',ticketId:ticket})).rejects.toThrow();expect((await a.query(api.mediaAssets.state,{}))).toHaveLength(1);
});
it('keeps public access closed by default and respects disabled users without deleting their data',async()=>{
 environment();vi.stubEnv('PUBLISHING_SAAS_ENABLED','false');const t=convexTest(schema,modules),a=t.withIdentity({subject:'customer',issuer:'https://fixture.clerk'});await expect(a.mutation(api.publishingUsers.register,{})).rejects.toThrow('غير مفعّل');
 vi.stubEnv('PUBLISHING_SAAS_ENABLED','true');const id=await a.mutation(api.publishingUsers.register,{});await t.run(c=>c.db.patch(id,{disabled:true}));await expect(a.query(api.publishingCollections.list,{})).rejects.toThrow('غير مفعّل');expect(await t.run(c=>c.db.get(id))).not.toBeNull();
});
