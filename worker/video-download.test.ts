import {describe,it,expect,vi} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {BrowserContext,Download} from 'playwright';
import {fetchFlowVideo,saveOriginalDownload} from './video-download';
describe('original video download recovery',()=>{
 it('recovers the same download when a CDP temporary artifact is missing',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'flow-download-'));
  const response={ok:()=>true,headers:()=>({'content-type':'video/mp4'}),body:async()=>Buffer.from('original-video'),dispose:vi.fn()};
  const get=vi.fn(async()=>response);
  const file={failure:async()=>null,saveAs:vi.fn(async()=>{throw Error('download.saveAs: ENOENT: missing temporary artifact');}),url:()=> 'https://storage.googleapis.com/original.mp4'};
  try{await saveOriginalDownload({request:{get}} as unknown as BrowserContext,file as unknown as Download,join(dir,'result.mp4'));expect((await readFile(join(dir,'result.mp4'))).toString()).toBe('original-video');expect(get).toHaveBeenCalledTimes(1);expect(response.dispose).toHaveBeenCalledOnce();}finally{await rm(dir,{recursive:true,force:true});}
 });
 it.each(['http://storage.googleapis.com/a','https://google.com.evil.example/a','file:///secret'])('never fetches an untrusted fallback %s',async url=>{
  const get=vi.fn();const file={failure:async()=>null,saveAs:async()=>{throw Error('ENOENT');},url:()=>url};
  await expect(saveOriginalDownload({request:{get}} as unknown as BrowserContext,file as unknown as Download,'unused')).rejects.toThrow('DOWNLOAD_UNSUPPORTED');expect(get).not.toHaveBeenCalled();
 });
 it('does not retry unrelated filesystem errors',async()=>{
  const get=vi.fn();const file={failure:async()=>null,saveAs:async()=>{throw Error('EACCES');},url:()=> 'https://storage.googleapis.com/original.mp4'};
  await expect(saveOriginalDownload({request:{get}} as unknown as BrowserContext,file as unknown as Download,'unused')).rejects.toThrow('EACCES');expect(get).not.toHaveBeenCalled();
 });
 it('rejects a login HTML response instead of saving it as a video',async()=>{
  const response={ok:()=>true,headers:()=>({'content-type':'text/html'}),body:vi.fn(),dispose:vi.fn()};
  await expect(fetchFlowVideo({request:{get:async()=>response}} as unknown as BrowserContext,'https://flow.google.com/original','unused')).rejects.toThrow('DOWNLOAD_FAILED');expect(response.body).not.toHaveBeenCalled();expect(response.dispose).toHaveBeenCalledOnce();
 });
 it('keeps the original browser failure when recovery is also refused',async()=>{
  const file={failure:async()=> 'net::ERR_FILE_NOT_FOUND',url:()=> 'blob:https://flow.google.com/fixture',saveAs:vi.fn()};
  await expect(saveOriginalDownload({request:{get:vi.fn()}} as unknown as BrowserContext,file as unknown as Download,'unused')).rejects.toThrow('original net::ERR_FILE_NOT_FOUND');expect(file.saveAs).not.toHaveBeenCalled();
 });
});
