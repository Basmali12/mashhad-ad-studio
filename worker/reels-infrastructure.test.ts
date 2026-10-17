import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {readBunnyUsage,readServerUsage,infrastructureReader} from './reels-infrastructure';
const config={zone:'fixture',endpoint:'https://storage.bunnycdn.com/',accessKey:'private-fixture'};
afterEach(()=>vi.restoreAllMocks());
it('sums real listing lengths across directories without reading file bytes or returning identities',async()=>{
 const fetcher=vi.fn<typeof fetch>().mockImplementation(async(url,init)=>{
  expect(init?.method??'GET').toBe('GET');expect(new Headers(init?.headers).get('AccessKey')).toBe('private-fixture');
  return Response.json(String(url).endsWith('/media/')?[{ObjectName:'one.mp4',Length:100,IsDirectory:false},{ObjectName:'two.png',Length:20,IsDirectory:false}]:[{ObjectName:'media',Length:0,IsDirectory:true},{ObjectName:'three.mp4',Length:50,IsDirectory:false}]);
 });const result=await readBunnyUsage(config,fetcher);expect(result).toMatchObject({status:'ok',files:3,bytes:170,videoFiles:2,videoBytes:150,requests:2});expect(JSON.stringify(result)).not.toContain('one.mp4');expect(JSON.stringify(result)).not.toContain(config.accessKey);
});
it.each([401,500])('reports unavailable rather than zero on Bunny HTTP %i',async status=>{
 const result=await readBunnyUsage(config,vi.fn().mockResolvedValue(new Response('',{status})));expect(result.status).toBe('unavailable');expect(result.bytes).toBeNull();expect(result.files).toBeNull();
});
it('rejects unsafe or malformed directory entries and never follows them',async()=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json([{ObjectName:'../other',IsDirectory:true}]));expect((await readBunnyUsage(config,fetcher)).status).toBe('unavailable');expect(fetcher).toHaveBeenCalledTimes(1);
});
it('bounds large trees and marks partial results explicitly',async()=>{
 const fetcher=vi.fn().mockImplementation(async()=>Response.json([{ObjectName:'next',IsDirectory:true},{ObjectName:'one.mp4',IsDirectory:false,Length:1}]));const result=await readBunnyUsage(config,fetcher);expect(result).toMatchObject({status:'partial',requests:100,files:100,bytes:100});
});
it('reads real spool file sizes and operating-system disk/RAM without deleting files',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'reels-metrics-'));try{await writeFile(join(dir,'upload.fixture'),Buffer.alloc(32));const result=await readServerUsage(dir);expect(result).toMatchObject({status:'ok',temporaryUploadBytes:32,temporaryUploadFiles:1});expect(result.diskTotalBytes).toBeGreaterThan(0);expect(result.memoryTotalBytes).toBeGreaterThan(0);expect(result.serviceRssBytes).toBeGreaterThan(0);}finally{await rm(dir,{recursive:true,force:true});}
});
it('deduplicates concurrent scans and reuses the read for one minute',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'reels-metrics-'));try{const fetcher=vi.fn().mockImplementation(async()=>Response.json([])),read=infrastructureReader(config,dir,fetcher);const [a,b]=await Promise.all([read(),read()]);expect(a).toEqual(b);expect(await read()).toEqual(a);expect(fetcher).toHaveBeenCalledTimes(1);}finally{await rm(dir,{recursive:true,force:true});}
});
