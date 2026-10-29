import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHmac} from 'node:crypto';
import {createFilmGateway} from '../gateway.mjs';
const env={MASHHAD_FILM_ENABLED:'YES',MASHHAD_FILM_ORIGIN:'https://studio.example.test',MASHHAD_CONVEX_URL:'https://fixture.convex.cloud',FILM_BACKEND_ORIGIN:'https://film.example.test',FILM_BRIDGE_SECRET:'synthetic-film-bridge-secret-at-least-32'};
async function fixture(t,{role='customer',profileFailure=false,bridgeFailure=false,legacyOwner,bridgeResult,publicMediaOrigin}={}){
 const calls=[];
 const handler=createFilmGateway({env:{...env,...(publicMediaOrigin?{FILM_PUBLIC_MEDIA_ORIGIN:publicMediaOrigin}:{}),...(legacyOwner?{MASHHAD_FILM_LEGACY_OWNER_ID:legacyOwner}:{})},fetchImpl:async(url,options)=>{
  calls.push({url:String(url),options});
  if(String(url)==='https://fixture.convex.cloud/api/query'){
   assert.equal(options.headers.Authorization,'Bearer synthetic-session');
   assert.deepEqual(JSON.parse(options.body),{path:'publishingUsers:profile',args:{},format:'json'});
   return Response.json(profileFailure?{status:'error',errorMessage:'private diagnostic'}:{status:'success',value:{id:'convexuser01',subject:'clerk_fixture_subject',name:'اسم اختباري',role}});
  }
  assert.equal(String(url),'https://film.example.test/api/film-bridge');
  if(bridgeFailure)throw Error('private provider detail');
  const body=JSON.parse(options.body);assert.equal(body.actor.isAdmin,role==='super-admin');
  const signature=createHmac('sha256',env.FILM_BRIDGE_SECRET).update(options.headers['x-film-time']+'\n'+options.headers['x-film-nonce']+'\n'+options.body).digest('hex');
  assert.equal(options.headers['x-film-signature'],signature);
  if(bridgeResult)return Response.json(bridgeResult);
  return Response.json(body.operation==='admin.accounts.list'?[]:{user:{id:body.actor.id,name:body.actor.name},wallet:{balanceMicroUSD:0},servers:[],enabled:true,planningEnabled:true,secret:'DO_NOT_RETURN'});
 }});
 const server=createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const base='http://127.0.0.1:'+server.address().port;
 const post=(body={operation:'session',input:{},requestId:'test-request-001'},headers={},path='/api/mashhad-film')=>fetch(base+path,{method:'POST',headers:{Origin:env.MASHHAD_FILM_ORIGIN,Authorization:'Bearer synthetic-session','Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 return {calls,post,base};
}
test('real HTTP bridge derives tenant from existing Mashhad profile and signs sanitized response',async t=>{
 const f=await fixture(t),r=await f.post();assert.equal(r.status,200);const body=await r.json();assert.equal(body.user.id,'mashhad-convexuser01');assert.equal(JSON.stringify(body).includes('DO_NOT_RETURN'),false);assert.equal(f.calls.length,2);
});
test('foreign/missing origin, missing bearer, client actor and unsupported operations cannot dispatch',async t=>{
 const f=await fixture(t);
 assert.equal((await f.post(undefined,{Origin:'https://evil.test'})).status,403);
 assert.equal((await f.post(undefined,{Authorization:''})).status,401);
 assert.equal((await f.post({operation:'session',input:{},requestId:'test-request-001',actor:{isAdmin:true}})).status,400);
 assert.equal((await f.post({operation:'secret.dump',input:{},requestId:'test-request-001'})).status,400);
 assert.equal(f.calls.filter(c=>c.url.includes('film.example')).length,0);
});
test('customer cannot use admin operations, and failed membership has no owner fallback',async t=>{
 const f=await fixture(t);const r=await f.post({operation:'admin.accounts.list',input:{},requestId:'test-request-001'});assert.equal(r.status,403);assert.equal(f.calls.filter(c=>c.url.includes('film.example')).length,0);
 const bad=await fixture(t,{profileFailure:true,legacyOwner:'old-owner'});assert.equal((await bad.post()).status,401);assert.equal(bad.calls.length,1);
});
test('existing owner can retain film identity; customer identity cannot use that mapping',async t=>{
 const a=await fixture(t,{role:'super-admin',legacyOwner:'previous-film-owner'});let r=await a.post();assert.equal((await r.json()).user.id,'previous-film-owner');
 const c=await fixture(t,{legacyOwner:'previous-film-owner'});r=await c.post();assert.equal((await r.json()).user.id,'mashhad-convexuser01');
});
test('paid requests require approval, errors are opaque, and bridge requests are never retried',async t=>{
 const f=await fixture(t);await f.post({operation:'rental.start',input:{serverId:'s',revision:1,priceMicroUSD:1,requestId:'rental-one',approved:false},requestId:'test-request-001'});assert.equal(f.calls.filter(c=>c.url.includes('film.example')).length,0);
 const bad=await fixture(t,{bridgeFailure:true});const r=await bad.post();const result=await r.json();assert.equal(result.error,'REQUEST_STATE_UNKNOWN');assert.equal(result.followExisting,true);assert.equal(JSON.stringify(result).includes('private'),false);assert.equal(bad.calls.filter(c=>c.url.includes('film.example')).length,1);
});
test('access endpoint reveals only verified role and health never contacts providers',async t=>{
 const f=await fixture(t);assert.equal((await fetch(f.base+'/health')).status,200);assert.equal(f.calls.length,0);const r=await f.post({}, {},'/api/mashhad-film/access');assert.deepEqual(await r.json(),{id:'mashhad-convexuser01',isAdmin:false});assert.equal(f.calls.length,1);
});
test('Pages preflight permits only the exact configured origin, POST and bounded headers without provider calls',async t=>{
 const f=await fixture(t);
 const preflight=(origin,method='POST',headers='authorization,content-type')=>fetch(f.base+'/api/mashhad-film',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':method,'Access-Control-Request-Headers':headers}});
 const r=await preflight(env.MASHHAD_FILM_ORIGIN);assert.equal(r.status,204);assert.equal(r.headers.get('access-control-allow-origin'),env.MASHHAD_FILM_ORIGIN);assert.equal(r.headers.get('access-control-allow-credentials'),null);
 assert.equal((await preflight('https://evil.test')).status,403);
 assert.equal((await preflight(env.MASHHAD_FILM_ORIGIN,'DELETE')).status,403);
 assert.equal((await preflight(env.MASHHAD_FILM_ORIGIN,'POST','x-untrusted')).status,403);
 assert.equal(f.calls.length,0);
 const denied=await f.post(undefined,{Authorization:''});assert.equal(denied.status,401);assert.equal(denied.headers.get('access-control-allow-origin'),env.MASHHAD_FILM_ORIGIN);
});

test('single film launch accepts only an explicit scoped price approval and never accepts a client account route',async t=>{
 const f=await fixture(t),base={projectId:'project-one',serverId:'server-one',revision:2,priceMicroUSD:3000000,requestId:'launch-one'};
 await f.post({operation:'project.launch',input:{...base,approved:false},requestId:'req-no-consent'});
 await f.post({operation:'project.launch',input:{...base,approved:true,accountId:'other-account'},requestId:'req-wrong-route'});
 assert.equal(f.calls.filter(c=>c.url.includes('film.example')).length,0);
 const response=await f.post({operation:'project.launch',input:{...base,approved:true},requestId:'req-approved'});assert.equal(response.status,200);
 const dispatched=f.calls.filter(c=>c.url.includes('film.example'));assert.equal(dispatched.length,1);const envelope=JSON.parse(dispatched[0].options.body);assert.equal(envelope.operation,'project.launch');assert.equal(envelope.input.serverId,'server-one');assert.equal(envelope.actor.id,'mashhad-convexuser01');
});


test('file library strips private paths, preserves merged index and requires explicit deletion approval',async t=>{
 const f=await fixture(t,{bridgeResult:[{id:'file-one',projectId:'project-one',index:'merged',kind:'film',name:'فيلم',createdAt:1,expiresAt:2,bytes:120,path:'/private/video.mp4',tokenSecret:'private'}]});
 const r=await f.post({operation:'files.list',input:{},requestId:'files-list-001'});assert.equal(r.status,200);const rows=await r.json();assert.equal(rows[0].index,'merged');assert.equal('path' in rows[0],false);assert.equal('tokenSecret' in rows[0],false);
 const before=f.calls.length;
 await f.post({operation:'files.delete',input:{id:'file-one',approved:false},requestId:'files-delete-001'});
 await f.post({operation:'files.ticket',input:{id:'file-one',customerId:'bob'},requestId:'files-ticket-001'});
 assert.equal(f.calls.filter(c=>c.url.includes('film.example')).length,1);
 assert.ok(f.calls.length>=before);
 await f.post({operation:'files.delete',input:{id:'file-one',approved:true},requestId:'files-delete-002'});
 assert.equal(f.calls.filter(c=>c.url.includes('film.example')).length,2);
});


test('signed image upload/view URLs use explicitly trusted public origin, independently of private bridge transport',async t=>{
 for(const [operation,segment] of [['project.reference.ticket','film-reference'],['project.reference.view','film-reference-view']]){
  const url='https://media.example.test/api/'+segment+'/image-one?expires=1234567890123&signature=abc';
  const f=await fixture(t,{publicMediaOrigin:'https://media.example.test',bridgeResult:{url,expires:1234567890123,maxBytes:4000000}});
  const r=await f.post({operation,input:{projectId:'project-one'},requestId:'image-ticket-001'});assert.equal((await r.json()).url,url);
  const bad=await fixture(t,{publicMediaOrigin:'https://other.example.test',bridgeResult:{url,expires:1234567890123}});
  const rejected=await bad.post({operation,input:{projectId:'project-one'},requestId:'image-ticket-002'});assert.equal((await rejected.json()).error,'REQUEST_STATE_UNKNOWN');
 }
});


test('image preview cannot start without explicit scoped approval; private prompt and storage fields are stripped',async t=>{
 const f=await fixture(t,{bridgeResult:{id:'project-one',preview:{id:'offer-one',status:'offered',model:'gpt-image-2-2026-04-21',estimatedUSD:.1,prompt:'PRIVATE',path:'/private',computedUSD:null,invoiceUSD:null}}});
 await f.post({operation:'project.preview.execute',input:{projectId:'project-one',quoteId:'offer-one',approved:false},requestId:'preview-denied'});assert.equal(f.calls.filter(c=>c.url.includes('film.example')).length,0);
 const r=await f.post({operation:'project.preview.execute',input:{projectId:'project-one',quoteId:'offer-one',approved:true},requestId:'preview-approved'});const dto=await r.json();assert.equal(dto.preview.status,'offered');assert.equal('prompt' in dto.preview,false);assert.equal('path' in dto.preview,false);assert.equal(f.calls.filter(c=>c.url.includes('film.example')).length,1);
});
