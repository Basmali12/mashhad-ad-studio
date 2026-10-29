import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHmac} from 'node:crypto';
import {createFilmGateway} from '../gateway.mjs';
const env={MASHHAD_FILM_ENABLED:'YES',MASHHAD_FILM_ORIGIN:'https://studio.example.test',MASHHAD_CONVEX_URL:'https://fixture.convex.cloud',FILM_BACKEND_ORIGIN:'https://film.example.test',FILM_BRIDGE_SECRET:'synthetic-film-bridge-secret-at-least-32'};
async function fixture(t,{role='customer',profileFailure=false,bridgeFailure=false,legacyOwner}={}){
 const calls=[];
 const handler=createFilmGateway({env:{...env,...(legacyOwner?{MASHHAD_FILM_LEGACY_OWNER_ID:legacyOwner}:{})},fetchImpl:async(url,options)=>{
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
