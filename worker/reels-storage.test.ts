import {assertReelDuration} from '../shared/reels-video';
import {describe,it,expect} from 'vitest';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {storageSettings,storageHandler} from './reels-storage';
import {createHash} from 'node:crypto';
const key=Buffer.alloc(32,7).toString('base64');
const env={BUNNY_STORAGE_ZONE:'fixture',BUNNY_STORAGE_ENDPOINT:'https://storage.bunnycdn.com/',BUNNY_STORAGE_ACCESS_KEY:'private-fixture',REELS_STORAGE_CLOUD:'https://fixture.convex.cloud',REELS_RUNNER_SITE:'https://fixture.convex.site',REELS_STORAGE_ORIGIN:'https://scan.example/reels-api',REELS_STORAGE_BRIDGE_SECRET:'x'.repeat(40),REELS_STORAGE_PREVIEW_KEY:key,REELS_STORAGE_CLIENT_ORIGINS:'https://iraqaistudio.com',REELS_STORAGE_TEMP:'/tmp/reels'};
it('requires stable HTTPS configuration and rejects a temporary or loopback backend',()=>{expect(()=>storageSettings({...env,REELS_RUNNER_SITE:'http://127.0.0.1:43241'})).toThrow();expect(()=>storageSettings({...env,REELS_STORAGE_ORIGIN:'http://localhost:43146'})).toThrow();expect(()=>storageSettings({...env,REELS_STORAGE_CLIENT_ORIGINS:'https://iraqaistudio.com.evil/path'})).toThrow();});
async function fixture(retention=false,duration=8){const dir=await mkdtemp(join(tmpdir(),'reels-storage-')),blobs=new Map<string,Buffer>(),assets=new Map<string,Record<string,unknown>>(),calls:{url:string;method:string;op?:string}[]=[];
 let banner:Record<string,unknown>|null=null;
 const seedBanner=()=>{const bytes=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0,0,0,0,0]),sha='c'.repeat(64),path='media/'+createHash('sha256').update('A').digest('hex')+'/'+sha+'.png';banner={subject:'A',path,sha256:sha,size:bytes.length,type:'image/png',verified:true};blobs.set('https://storage.bunnycdn.com/fixture/'+path,bytes);return bytes;};
 const fetcher:typeof fetch=async(input,init)=>{const url=String(input),method=init?.method??'GET';calls.push({url,method});if(url.endsWith('/reels-storage')){const {op,...a}=JSON.parse(String(init?.body));calls.at(-1)!.op=op;if(op==='bannerRetiredAsset')return a.fence==='valid-fence'?Response.json({...banner,zone:'fixture'}):new Response('',{status:403});if(op==='bannerRetiredCompleted')return Response.json(null);if(op==='bannerAsset')return banner&&a.revision==='live-banner'?Response.json(banner):new Response('',{status:403});if(op==='uploadFailed')return Response.json(null);if(op==='retentionAsset'){if(a.fence!=='valid-fence')return new Response('',{status:403});return Response.json({zone:'fixture',subject:'A',path:'media/'+createHash('sha256').update('A').digest('hex')+'/'+'a'.repeat(64)+'.mp4',sha256:'a'.repeat(64),size:16,type:'video/mp4',verified:true});}if(op==='retentionCompleted')return Response.json(null);if(op==='list')return Response.json([...assets.values()].filter(x=>x.subject===a.subject).map(x=>({id:x.sha256,type:x.type,size:x.size})));if(op==='record'){assets.set(a.subject+':'+a.sha256,{...a,path:a.objectPath,verified:true});return Response.json('asset-id');}if(op==='asset'){const asset=assets.get(a.subject+':'+a.key);return asset?Response.json(asset):new Response('',{status:403});}throw Error('Unexpected operation');}
  if(method==='PUT'){const chunks:Uint8Array[]=[];const reader=(init!.body as ReadableStream<Uint8Array>).getReader();for(;;){const {done,value}=await reader.read();if(done)break;chunks.push(value);}blobs.set(url,Buffer.concat(chunks));return new Response('{}');}const bytes=blobs.get(url);if(!bytes)return new Response('',{status:404});const range=new Headers(init?.headers).get('Range');if(range){const m=/bytes=(\d+)-(\d+)/.exec(range)!;const start=Number(m[1]),end=Number(m[2]);return new Response(bytes.subarray(start,end+1),{status:206,headers:{'Content-Range':`bytes ${start}-${end}/${bytes.length}`}});}return new Response(bytes);};
 const config=storageSettings({...env,REELS_RETENTION_ENABLED:retention?'true':'false',REELS_STORAGE_TEMP:dir}),handler=storageHandler(config,fetcher,token=>({query:async(name,args)=>{if(name==='publishingUsers:profile')return {subject:token};if(name==='publishingUploadTickets:inspect')return {subject:args.id==='other'?'B':token,type:'video/mp4',size:16};throw Error('Unexpected query');},mutation:async(name)=>{if(name==='publishingUploadTickets:start')return 'fixture-upload-fence';throw Error('Deletion forbidden');}}),async()=>assertReelDuration(duration));const server=createServer(handler);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as {port:number}).port;
 const request=(path:string,init:RequestInit={})=>fetch(`http://127.0.0.1:${port}${path}`,init),post=(path:string,token='A',extras:Record<string,string>={},body?:BodyInit)=>request(path,{method:'POST',headers:{Origin:'https://iraqaistudio.com',Authorization:'Bearer '+token,...extras},body});const cleanup=async()=>{await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});};return {request,post,calls,cleanup,seedBanner};}
describe('production storage boundary without provider writes',()=>{
 it('authenticates, streams a verified upload, lists only its owner and serves signed Range without cookies',async()=>{const f=await fixture();try{const data=Buffer.from([0,0,0,16,102,116,121,112,1,2,3,4,5,6,7,8]),id=crypto.randomUUID(),r=await f.post('/api/bunny-upload','A',{'Content-Type':'video/mp4','X-Upload-Id':id,'X-Upload-Ticket':'ticket'},data);expect(r.status).toBe(200);const result=await r.json();expect(result.sha256).toBe(createHash('sha256').update(data).digest('hex'));expect(JSON.stringify(result)).not.toContain('private-fixture');const handshake=await(await f.post('/api/bunny-media')).json();expect(handshake).toEqual([]);const rows=await(await f.post('/api/bunny-media','A',{'Content-Type':'application/json'},JSON.stringify({key:result.sha256}))).json();expect(rows).toHaveLength(1);expect(await(await f.post('/api/bunny-media','B')).json()).toEqual([]);const path='/api/bunny-preview?'+new URL(rows[0].url).searchParams.toString(),preview=await f.request(path,{headers:{Range:'bytes=0-7'}});expect(preview.status).toBe(206);expect(preview.headers.get('Content-Range')).toBe('bytes 0-7/16');expect(Buffer.from(await preview.arrayBuffer())).toEqual(data.subarray(0,8));const other=await f.post('/api/bunny-progress','B',{'X-Upload-Id':id});expect(other.status).toBe(403);const altered=new URLSearchParams(new URL(rows[0].url).searchParams);altered.set('grant',altered.get('grant')!+'x');expect((await f.request('/api/bunny-preview?'+altered)).status).toBe(403);}finally{await f.cleanup();}});
 it('rejects unauthorized, foreign tickets, missing signatures, CORS abuse and deletion without making storage writes',async()=>{const f=await fixture();try{expect((await f.request('/api/bunny-media',{method:'POST',headers:{Origin:'https://iraqaistudio.com'}})).status).toBe(401);expect((await f.request('/api/bunny-preview')).status).toBe(403);expect((await f.request('/api/bunny-media',{method:'POST',headers:{Origin:'https://evil.example',Authorization:'Bearer A'}})).status).toBe(403);expect((await f.post('/api/bunny-delete','A',{'Content-Type':'application/json'},JSON.stringify({confirm:true,key:'a'.repeat(64)}))).status).toBe(403);expect((await f.post('/api/bunny-upload','A',{'Content-Type':'video/mp4','X-Upload-Id':crypto.randomUUID(),'X-Upload-Ticket':'other'},Buffer.alloc(16))).status).toBe(403);expect(f.calls.filter(c=>['PUT','DELETE'].includes(c.method))).toEqual([]);}finally{await f.cleanup();}});
});

it('retention requires the internal secret and database fence, and confirms an already absent object without enabling manual deletes',async()=>{
 const f=await fixture(true);try{
 const body=JSON.stringify({assetId:'fixture',fence:'valid-fence'}),send=(token:string,data=body)=>f.request('/api/retention-delete',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:data});
 expect((await send('A')).status).toBe(403);expect((await send('x'.repeat(40),JSON.stringify({assetId:'fixture',fence:'foreign'}))).status).toBe(403);expect(f.calls.some(c=>c.method==='DELETE')).toBe(false);
 expect((await send('x'.repeat(40),JSON.stringify({assetId:'fixture',fence:'valid-fence',path:'other-owner'}))).status).toBe(403);
 expect((await send('x'.repeat(40))).status).toBe(200);expect(f.calls.filter(c=>c.method==='DELETE')).toHaveLength(1);
 expect((await f.post('/api/bunny-delete','A',{'Content-Type':'application/json'},JSON.stringify({confirm:true,key:'a'.repeat(64)}))).status).toBe(403);
 }finally{await f.cleanup();}
});
it('download is an authenticated signed stream with attachment headers, not a public permanent Bunny URL',async()=>{
 const f=await fixture();try{const data=Buffer.from([0,0,0,16,102,116,121,112,1,2,3,4,5,6,7,8]),r=await f.post('/api/bunny-upload','A',{'Content-Type':'video/mp4','X-Upload-Id':crypto.randomUUID(),'X-Upload-Ticket':'ticket'},data),result=await r.json();const rows=await(await f.post('/api/bunny-media','A',{'Content-Type':'application/json'},JSON.stringify({key:result.sha256}))).json();const response=await f.request('/api/bunny-preview?'+new URL(rows[0].url).searchParams+'&download=1');expect(response.headers.get('Content-Disposition')).toContain('attachment');expect(Buffer.from(await response.arrayBuffer())).toEqual(data);
 }finally{await f.cleanup();}
});

it('never exposes server metrics or Bunny listings to a customer bearer token',async()=>{
 const f=await fixture();try{expect((await f.request('/api/admin-infrastructure')).status).toBe(403);expect((await f.request('/api/admin-infrastructure',{headers:{Authorization:'Bearer A'}})).status).toBe(403);expect(f.calls).toEqual([]);}finally{await f.cleanup();}
});

it('rejects a video over 180 seconds before Bunny PUT or recording accepted quota, even through a direct request',async()=>{
 for(const duration of [180.001,181,NaN,Infinity,0]){const f=await fixture(false,duration);try{
 const data=Buffer.from([0,0,0,16,102,116,121,112,1,2,3,4,5,6,7,8]),response=await f.post('/api/bunny-upload','A',{'Content-Type':'video/mp4','X-Upload-Id':crypto.randomUUID(),'X-Upload-Ticket':'ticket'},data);
 expect(response.status).toBe(400);expect((await response.json()).error).toMatch(/مدة|دقائق/);expect(f.calls.some(c=>c.method==='PUT')).toBe(false);expect(f.calls.some(c=>c.op==='record')).toBe(false);expect(f.calls.some(c=>c.op==='uploadFailed')).toBe(true);
 }finally{await f.cleanup();}}
});
it('accepts the exact 180 second upper limit',async()=>{const f=await fixture(false,180);try{const data=Buffer.from([0,0,0,16,102,116,121,112,1,2,3,4,5,6,7,8]),r=await f.post('/api/bunny-upload','A',{'Content-Type':'video/mp4','X-Upload-Id':crypto.randomUUID(),'X-Upload-Ticket':'ticket'},data);expect(r.status).toBe(200);}finally{await f.cleanup();}});

it('serves only the explicitly selected banner without cookies and never an arbitrary private media key',async()=>{
 const f=await fixture();try{const bytes=f.seedBanner();expect((await f.request('/api/site-banner?key=private-file')).status).toBe(404);expect((await f.request('/api/site-banner?revision=old-banner')).status).toBe(404);
 const response=await f.request('/api/site-banner?revision=live-banner');expect(response.status).toBe(200);expect(response.headers.get('Content-Type')).toBe('image/png');expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);expect(f.calls.some(c=>c.method==='PUT'||c.method==='DELETE')).toBe(false);
 }finally{await f.cleanup();}
});

it('caches the public banner by immutable revision and supports conditional requests without streaming Bunny again',async()=>{
 const f=await fixture();try{f.seedBanner();const r=await f.request('/api/site-banner?revision=live-banner');await r.arrayBuffer();expect(r.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');const reads=f.calls.filter(c=>c.method==='GET'&&c.url.includes('storage.bunnycdn.com')).length;
 const cached=await f.request('/api/site-banner?revision=live-banner',{headers:{'If-None-Match':r.headers.get('ETag')!}});expect(cached.status).toBe(304);expect(f.calls.filter(c=>c.method==='GET'&&c.url.includes('storage.bunnycdn.com'))).toHaveLength(reads);
 expect((await f.request('/api/site-banner?revision=new-banner')).status).toBe(404);
 }finally{await f.cleanup();}
});
it('retired banner deletion is private, fenced and independent from video/manual deletion switches',async()=>{
 const f=await fixture();try{f.seedBanner();const send=(token:string,fence:string)=>f.request('/api/banner-delete',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({assetId:'old',fence})});
 expect((await send('A','valid-fence')).status).toBe(403);expect((await send('x'.repeat(40),'wrong')).status).toBe(403);expect(f.calls.some(c=>c.method==='DELETE')).toBe(false);
 expect((await send('x'.repeat(40),'valid-fence')).status).toBe(200);expect(f.calls.filter(c=>c.method==='DELETE')).toHaveLength(1);expect(f.calls.some(c=>c.op==='bannerRetiredCompleted')).toBe(true);
 }finally{await f.cleanup();}
});
