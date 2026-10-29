import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {randomBytes} from 'node:crypto';import {spawnSync} from 'node:child_process';import {createServer} from 'node:http';
import {Store} from '../engine/store.mjs';import {createFilmImagePreview,PREVIEW_MODEL} from '../engine/film-image-preview.mjs';
async function fixture(t,{fail=false,budget=1000000,withEdit=false}={}){
 const folder=await mkdtemp(path.join(tmpdir(),'film-image-preview-')),store=new Store(folder,randomBytes(32).toString('base64'));let now=Date.now(),calls=0;const p={id:'project-one',customerId:'owner-one',orientation:'portrait',state:'draft',messages:[]};store.put('film-project',p);store.put('config',{id:'openai-director',credentials:store.seal({key:'synthetic-local-only'},'openai-director')});
 const jpg=path.join(folder,'fixture.jpg'),generated=spawnSync(process.env.ENGINE_FFMPEG_BIN||'ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=16x16','-frames:v','1',jpg],{windowsHide:true});assert.equal(generated.status,0,'local CPU JPEG fixture requires ffmpeg');const bytes=await readFile(jpg);
 const service=createFilmImagePreview({store,origin:'https://fixture.test',secret:'synthetic-preview-signing-secret-for-tests',origins:['https://front.test'],now:()=>now,budgetMicroUSD:budget,fetcher:async(url,options)=>{calls++;assert.equal(url,'https://api.openai.com/v1/images/'+(withEdit?'edits':'generations'));if(withEdit){assert.ok(options.body instanceof FormData);assert.ok(options.body.get('image') instanceof Blob);}const b=withEdit?Object.fromEntries(options.body.entries()):JSON.parse(options.body);assert.equal(b.model,PREVIEW_MODEL);assert.equal(Number(b.n),1);assert.equal(b.quality,'low');assert.equal(b.output_format,'jpeg');assert.equal(b.size,'864x1536');assert.ok(!b.safety_identifier.includes(p.customerId));if(fail)throw Error('ambiguous connection');return Response.json({data:[{b64_json:bytes.toString('base64')}],usage:{input_tokens_details:{text_tokens:100,image_tokens:0},output_tokens:200}});}});
 t.after(async()=>{await service.close();store.close();await rm(folder,{recursive:true,force:true});});await service.initialize();await service.offer(p,'A cinematic Iraqi courtyard with two fictional characters in warm light.');store.put('film-project',p);
 async function finish(){for(let i=0;i<100;i++){const r=store.get('film-image-preview',p.preview.id);if(r&&!['queued','running'].includes(r.status))return r;await new Promise(r=>setTimeout(r,5));}throw Error('fixture did not settle');}
 return {store,folder,p,service,bytes,finish,calls:()=>calls,advance:n=>now+=n};
}
test('preview requires scoped approval, dispatches once under duplicate requests and persists only a private image',async t=>{
 const f=await fixture(t);await assert.rejects(f.service.execute(f.p,f.p.preview.id,false),/APPROVAL_REQUIRED/);await assert.rejects(f.service.execute({...f.p,customerId:'bob'},f.p.preview.id,true),/NOT_FOUND/);assert.equal(f.calls(),0);
 await Promise.all([f.service.execute(f.p,f.p.preview.id,true),f.service.execute(f.p,f.p.preview.id,true)]);const r=await f.finish();assert.equal(r.status,'completed');assert.equal(f.calls(),1);assert.equal(f.store.all('film-text-reservation').length,1);assert.equal(r.computedUSD,.0065);assert.equal(JSON.stringify(r).includes(f.bytes.toString('base64')),false);
 const p=f.store.get('film-project',f.p.id),ticket=await f.service.view(p),server=createServer((req,res)=>f.service.handle(req,res,new URL(req.url,'https://fixture.test'),true));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const url='http://127.0.0.1:'+server.address().port+new URL(ticket.url).pathname+new URL(ticket.url).search;
 const response=await fetch(url,{headers:{origin:'https://front.test'}});assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),f.bytes);assert.equal((await fetch(url,{headers:{origin:'https://evil.test'}})).status,403);
 f.advance(7*86400000);assert.equal((await fetch(url)).status,403);await f.service.cleanup();assert.equal(f.store.get('film-image-preview',r.id).status,'expired');await assert.rejects(readFile(path.join(f.folder,'film-previews',p.id,r.id+'.image')),{code:'ENOENT'});
});
test('ambiguous image response is not retried, and a changed orientation or exhausted budget cannot dispatch',async t=>{
 const f=await fixture(t,{fail:true});await f.service.execute(f.p,f.p.preview.id,true);assert.equal((await f.finish()).status,'uncertain');await f.service.execute(f.p,f.p.preview.id,true);assert.equal(f.calls(),1);
 const b=await fixture(t,{budget:1});await assert.rejects(b.service.execute(b.p,b.p.preview.id,true),/TEXT_BUDGET_LIMIT/);assert.equal(b.calls(),0);const c=await fixture(t);c.p.orientation='landscape';c.store.put('film-project',c.p);await assert.rejects(c.service.execute(c.p,c.p.preview.id,true),/PREVIEW_NOT_AVAILABLE/);assert.equal(c.calls(),0);
});


test('an uploaded opening reference uses the official edit endpoint with image bytes and one output',async t=>{
 const f=await fixture(t,{withEdit:true});await f.service.execute(f.p,f.p.preview.id,true,'data:image/jpeg;base64,'+f.bytes.toString('base64'));assert.equal((await f.finish()).status,'completed');assert.equal(f.calls(),1);
});
