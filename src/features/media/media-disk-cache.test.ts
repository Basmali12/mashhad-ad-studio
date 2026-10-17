import 'fake-indexeddb/auto';
import {afterEach,expect,it,vi} from 'vitest';
import {readMedia,writeMedia,clearMediaScope} from './media-disk-cache';
import {downloadProtectedMedia,ProtectedMediaCache} from './protected-media';
afterEach(()=>vi.unstubAllGlobals());
it('persists a blob across loaders but checks authorization on every disk hit',async()=>{
 const endpoint='https://example.invalid/files?id=persistent',signal=new AbortController().signal;
 const fetch=vi.fn().mockResolvedValueOnce(Response.json({size:3,type:'video/mp4'})).mockResolvedValueOnce(new Response(new Blob(['mp4'],{type:'video/mp4'}))).mockResolvedValueOnce(Response.json({size:3,type:'video/mp4'}));vi.stubGlobal('fetch',fetch);
 const first=await downloadProtectedMedia(endpoint,async()=>'test',signal,()=>{},1000,'disk-user');
 const second=await downloadProtectedMedia(endpoint,async()=>'test',signal,()=>{},1000,'disk-user');
 expect(await second.text()).toBe(await first.text());expect(fetch).toHaveBeenCalledTimes(3);expect(fetch.mock.calls[2][0]).toContain('metadata=1');
 fetch.mockResolvedValueOnce(new Response('',{status:404}));await expect(downloadProtectedMedia(endpoint,async()=>'test',signal,()=>{},1000,'disk-user')).rejects.toThrow('الملف المحمي');expect(await readMedia(`disk-user:${endpoint}`,3,'video/mp4')).toBeNull();
});
it('isolates accounts, invalidates changed metadata and removes a logged out scope',async()=>{
 await writeMedia('account-a:one',new Blob(['abc'],{type:'video/mp4'}));await writeMedia('account-b:one',new Blob(['b'],{type:'video/mp4'}));
 expect(await readMedia('account-c:one',3,'video/mp4')).toBeNull();expect(await readMedia('account-a:one',4,'video/mp4')).toBeNull();
 await clearMediaScope('account-b');expect(await readMedia('account-b:one',1,'video/mp4')).toBeNull();
});
it('does not serve memory after the server rejects a deleted file',async()=>{
 const cache=new ProtectedMediaCache(),loader=vi.fn(async()=>new Blob(['mp4']));await cache.get('one',loader);
 await expect(cache.get('one',loader,undefined,undefined,async()=>{throw new Error('deleted')})).rejects.toThrow('deleted');await cache.get('one',loader);expect(loader).toHaveBeenCalledTimes(2);cache.dispose();
});
it('fails closed offline even when a local video exists and falls back when disk storage fails',async()=>{
 const endpoint='https://example.invalid/files?id=offline',key=`offline-user:${endpoint}`;await writeMedia(key,new Blob(['mp4'],{type:'video/mp4'}));
 vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('offline')));await expect(downloadProtectedMedia(endpoint,async()=>'test',new AbortController().signal,()=>{},1000,'offline-user')).rejects.toThrow('offline');
 vi.stubGlobal('indexedDB',undefined);vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({size:3,type:'video/mp4'})).mockResolvedValueOnce(new Response(new Blob(['mp4']))));expect((await downloadProtectedMedia(endpoint,async()=>'test',new AbortController().signal,()=>{},1000,'offline-user')).size).toBe(3);
});
