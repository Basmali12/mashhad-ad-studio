/* global fetch, URLSearchParams */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAccountServer} from './server.mjs';
import {createProfileManager} from './profiles.mjs';
test('subscription closure denies existing and new portal sessions and redirects direct links',async()=>{
 let closed=false,opened=0;
 const origin='https://scan.iraqaistudio.com',profile={subject:'alice',key:'a'.repeat(24)};
 const server=createAccountServer({identity:{publishableKey:'fixture'},origin,workerToken:'fixture',verify:async()=>profile,observe:async()=>{},accessDisabled:()=>closed,manager:{idle:async()=>{},open:async()=>{opened++;}}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/flow-account/`;
 try{
  const login=await fetch(base+'login',{method:'POST',headers:{origin},body:new URLSearchParams({token:'fixture'})});
  assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];closed=true;
  for(const route of ['', 'google-state', 'vnc.html']){const r=await fetch(base+route,{headers:{cookie},redirect:'manual'});assert.equal(r.status,302);assert.equal(r.headers.get('location'),'https://iraqaistudio.com/');}
  for(const route of ['login','google-input','confirm']){const r=await fetch(base+route,{method:'POST',headers:{origin,cookie},body:'{}'});assert.equal(r.status,403);assert.equal(r.headers.get('set-cookie'),null);}
  assert.equal(opened,1);
 }finally{await new Promise(r=>server.close(r));}
});
test('balance reads wait for account linking and resume after verified completion',async()=>{
 const profile={subject:'alice',key:'a'.repeat(24)},origin='https://scan.iraqaistudio.com';let acquired=0,observed=0;
 const manager={idle:async()=>{},open:async()=>{},workerProfile:async()=>profile,google:async()=>({stage:'ready',message:'Verified'}),acquire:async()=>{acquired++;return 'fixture-lease';}};
 const server=createAccountServer({identity:{publishableKey:'fixture'},origin,manager,workerToken:'fixture',verify:async()=>profile,observe:async(p,ready)=>{assert.deepEqual(p,profile);assert.equal(ready,true);observed++;}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{const login=await fetch(base+'/flow-account/login',{method:'POST',headers:{origin},body:new URLSearchParams({token:'fixture'})}),cookie=login.headers.get('set-cookie').split(';')[0];
 const balance=()=>fetch(base+'/internal/session',{method:'POST',headers:{authorization:'Bearer fixture'},body:JSON.stringify({op:'balance',subject:'alice'})});
 assert.equal((await balance()).status,429);assert.equal(acquired,0);
 assert.equal((await fetch(base+'/flow-account/google-state',{headers:{cookie}})).status,200);assert.equal(observed,1);
 assert.equal((await balance()).status,200);assert.equal(acquired,1);
 }finally{await new Promise(r=>server.close(r));}
});
test('a worker cannot acquire a ready profile when the actual Google identity differs',async()=>{
 const p={subject:'alice',key:'a'.repeat(24),state:'ready'};
 const manager=createProfileManager({workerProfile:async()=>p,launch:async()=>({}),stop:async()=>{},check:async()=>({ready:false,message:'Different Google account'})});
 await assert.rejects(manager.acquire(p),e=>e.publicMessage==='Different Google account');
});
test('account choice is saved only for the authenticated active profile and cannot change during a worker lease',async()=>{
 const p={subject:'alice',key:'a'.repeat(24),state:'ready'},saved=[];
 const manager=createProfileManager({workerProfile:async()=>p,launch:async()=>({}),stop:async()=>{},check:async()=>true,saveEmail:async(profile,email)=>saved.push({key:profile.key,email})});
 await manager.open(p);await manager.chooseEmail(p,'RIGHT@example.com');assert.deepEqual(saved,[{key:p.key,email:'right@example.com'}]);
 await assert.rejects(manager.chooseEmail({...p,subject:'bob'},'other@example.com'));
 const lease=await manager.acquire(p);await assert.rejects(manager.chooseEmail(p,'other@example.com'));await manager.release(lease);
});
test('a pending customer receives an activation reference without opening a browser or receiving a session',async()=>{
 let opened=false;
 const manager={idle:async()=>undefined,open:async()=>{opened=true;}};
 const origin='https://scan.iraqaistudio.com',server=createAccountServer({identity:{publishableKey:'fixture'},manager,origin,workerToken:'fixture',verify:async()=>({pending:true,publicId:'MS-fixture'}),observe:async()=>undefined});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const r=await fetch(`http://127.0.0.1:${server.address().port}/flow-account/login`,{method:'POST',headers:{origin},body:new URLSearchParams({token:'fixture'})});assert.equal(r.status,403);assert.equal(r.headers.get('set-cookie'),null);assert.match((await r.json()).error,/MS-fixture/);assert.equal(opened,false);}
 finally{await new Promise(resolve=>server.close(resolve));}
});
test('Google field gateway rejects anonymous and cross-origin submissions and derives the profile from the session',async()=>{
 const profile={subject:'alice',key:'a'.repeat(24)},origin='https://scan.iraqaistudio.com';
 let inputs=0;
 const manager={open:async()=>undefined,idle:async()=>undefined,assertViewer:p=>assert.deepEqual(p,profile),google:async(p,op,input)=>{assert.deepEqual(p,profile);assert.equal(op,'input');assert.deepEqual(input,{stage:'email',value:'fixture-only'});inputs++;return {ok:true};}};
 const server=createAccountServer({identity:{publishableKey:'fixture'},manager,origin,workerToken:'fixture',verify:async()=>profile,observe:async()=>undefined});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}/flow-account/`;
 try{
  const payload=JSON.stringify({stage:'email',value:'fixture-only',subject:'bob',key:'b'.repeat(24)});
  assert.equal((await fetch(base+'google-input',{method:'POST',headers:{origin},body:payload})).status,401);
  const login=await fetch(base+'login',{method:'POST',headers:{origin},body:new URLSearchParams({token:'fixture'})});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(base+'google-input',{method:'POST',headers:{origin:'https://evil.example',cookie},body:payload})).status,403);
  for(let n=0;n<6;n++){const response=await fetch(base+'google-input',{method:'POST',headers:{origin,cookie},body:payload});assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true});}
  assert.equal((await fetch(base+'google-input',{method:'POST',headers:{origin,cookie},body:payload})).status,429);
  assert.equal(inputs,6);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('Google form operations require the current customer and are denied during generation',async()=>{
 const a={subject:'alice',key:'a'.repeat(24),state:'ready'},b={subject:'bob',key:'b'.repeat(24),state:'ready'};
 let calls=0;
 const manager=createProfileManager({workerProfile:async()=>a,launch:async()=>({}),stop:async()=>undefined,check:async()=>true,google:async()=>{calls++;return {stage:'email'};}});
 await manager.open(a);
 await assert.rejects(manager.google(b,'state'),e=>e.code==='BUSY');
 assert.equal(calls,0);
 assert.deepEqual(await manager.google(a,'state'),{stage:'email'});
 const lease=await manager.acquire(a);
 await assert.rejects(manager.google(a,'input',{stage:'email',value:'fixture-only'}),e=>e.code==='BUSY');
 assert.equal(calls,1);
 await manager.release(lease);
 await manager.lock(a);
});
test('private profiles cannot switch while another customer owns the screen or worker lease',async()=>{let starts=0,stops=0;const a={subject:'alice',key:'a'.repeat(24),state:'ready'},b={subject:'bob',key:'b'.repeat(24),state:'ready'};const manager=createProfileManager({workerProfile:async()=>a,launch:async()=>{starts++;return {};},stop:async()=>{stops++;},check:async()=>true,idleMs:-1});await manager.open(a);await assert.rejects(manager.open(b),e=>e.code==='BUSY');assert.throws(()=>manager.assertActive(b));const lease=await manager.acquire(a);await manager.idle();assert.equal(stops,0);await manager.lock(a);assert.equal(stops,0);await manager.release(lease);await manager.idle();assert.equal(stops,1);await manager.open(b);assert.equal(starts,2);assert.throws(()=>manager.assertActive(a));});
test('gateway derives identity from token, denies anonymous/private worker operations and revokes cookies',async()=>{const p={subject:'alice',key:'a'.repeat(24)};let confirmed=0;const manager=createProfileManager({workerProfile:async()=>p,launch:async()=>({}),stop:async()=>undefined,check:async()=>true});const origin='https://scan.iraqaistudio.com',server=createAccountServer({identity:{publishableKey:'fixture'},origin,workerToken:'fixture-only',manager,verify:async token=>token==='fixture-token'?p:null,observe:async(profile,ready)=>{assert.deepEqual(profile,p);assert.equal(ready,true);confirmed++;}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/flow-account/`;try{assert.equal((await fetch(base+'vnc.html')).status,401);assert.equal((await fetch(base+'login',{method:'POST',headers:{origin:'https://evil.example'}})).status,403);const login=await fetch(base+'login',{method:'POST',headers:{origin},body:new URLSearchParams({token:'fixture-token',subject:'bob',key:'b'.repeat(24)})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];assert.equal((await fetch(base+'confirm',{method:'POST',headers:{origin,cookie}})).status,200);assert.equal(confirmed,1);assert.equal((await fetch(base.replace('/flow-account/','/internal/session'),{method:'POST',headers:{origin},body:'{}'})).status,401);await fetch(base+'logout',{method:'POST',headers:{origin,cookie}});assert.equal((await fetch(base+'confirm',{method:'POST',headers:{origin,cookie}})).status,401);}finally{await new Promise(r=>server.close(r));}});
