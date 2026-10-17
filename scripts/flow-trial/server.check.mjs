/* global fetch, URLSearchParams */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {scryptSync} from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import {createTrialServer} from './server.mjs';

test('private desktop denies anonymous HTTP/websocket and cross-origin login; logout revokes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'flow-trial-')),authFile=join(dir,'access.json');
 const password='test-only-not-a-real-credential',salt='test-salt';await writeFile(authFile,JSON.stringify({salt,hash:scryptSync(password,salt,64).toString('hex')}));
 const upstream=http.createServer((req,res)=>res.end(req.url));await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const origin='https://scan.iraqaistudio.com',server=createTrialServer({authFile,origin,upstreamPort:upstream.address().port,ttl:5000});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const port=server.address().port,base=`http://127.0.0.1:${port}/flow-trial/`;
 try{
  assert.equal((await fetch(base+'vnc.html')).status,401);
  assert.equal((await fetch(base+'login',{method:'POST',headers:{origin:'https://evil.example'},body:new URLSearchParams({password})})).status,403);
  assert.equal((await fetch(base+'login',{method:'POST',headers:{origin},body:'password=wrong'})).status,401);
  const login=await fetch(base+'login',{method:'POST',headers:{origin},body:new URLSearchParams({password})});assert.equal(login.status,200);
  const setCookie=login.headers.get('set-cookie');assert.match(setCookie,/HttpOnly; Secure; SameSite=Strict/);const cookie=setCookie.split(';')[0];
  const result=await fetch(base+'vnc.html?resize=scale',{headers:{cookie}});assert.equal(result.status,200);assert.equal(await result.text(),'/vnc.html?resize=scale');assert.equal(result.headers.get('cache-control'),'no-store');
  const denied=await new Promise(resolve=>{const s=net.connect(port,'127.0.0.1',()=>s.write(`GET /flow-trial/websockify HTTP/1.1\r\nHost: localhost\r\nOrigin: ${origin}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`));s.on('data',d=>resolve(String(d)));});assert.match(denied,/401/);
  assert.equal((await fetch(base+'logout',{method:'POST',headers:{origin,cookie}})).status,200);assert.equal((await fetch(base+'vnc.html',{headers:{cookie}})).status,401);
  await rm(authFile);assert.equal((await fetch(base+'login',{method:'POST',headers:{origin},body:new URLSearchParams({password})})).status,503);
 }finally{await new Promise(r=>server.close(r));await new Promise(r=>upstream.close(r));await rm(dir,{recursive:true,force:true});}
});
