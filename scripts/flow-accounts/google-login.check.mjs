import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readGoogleStage,submitGoogleField,openGoogleLogin} from './google-login.mjs';
function fixture(url,stage,id='target-1'){
 const events=[];
 const page={context:()=>({newCDPSession:async()=>({send:async()=>({targetInfo:{targetId:id}}),detach:async()=>{}})}),goto:async()=>{},url:()=>url,evaluate:async(_fn,{value})=>{assert.equal(value,'fixture-only');events.push('fill');return true;},locator:selector=>({count:async()=>selector.includes('button')?1:selector.includes('identifierId')?(stage==='email'?1:0):(stage==='password'?1:0),click:async()=>{events.push('next');}})};
 return {browser:{contexts:()=>[{pages:()=>[page]}]},events};
}
test('email and password are submitted only to the actual matching Google step',async()=>{
 for(const stage of ['email','password']){
  const path=stage==='email'?'/v3/signin/identifier':'/v3/signin/challenge/pwd';
  const {browser,events}=fixture('https://accounts.google.com'+path,stage);
  assert.equal((await readGoogleStage(browser)).stage,stage);
  await submitGoogleField(browser,{stage,value:'fixture-only'});
  assert.deepEqual(events,['fill','next']);
 }
});
test('designated login target survives reconnects and never writes to a competing tab',async()=>{
 const a=fixture('https://accounts.google.com/v3/signin/identifier','email','old');
 const b=fixture('https://accounts.google.com/v3/signin/challenge/pwd','password','selected');
 const browser={contexts:()=>[{pages:()=>[a.browser.contexts()[0].pages()[0],b.browser.contexts()[0].pages()[0]]}]};
 const selection={targetId:'selected'};
 assert.equal((await readGoogleStage(browser,selection)).stage,'password');
 await submitGoogleField(browser,{stage:'password',value:'fixture-only'},selection);
 assert.deepEqual(a.events,[]);assert.deepEqual(b.events,['fill','next']);
 assert.equal((await readGoogleStage(browser,{targetId:'missing'})).stage,'manual');
 await assert.rejects(submitGoogleField(browser,{stage:'email',value:'fixture-only'},{targetId:'missing'}));
});
test('explicit start creates and reuses a designated tab without closing existing tabs',async()=>{
 const old=fixture('https://accounts.google.com/v3/signin/identifier','email','old').browser.contexts()[0].pages()[0];
 const chosen=fixture('https://accounts.google.com/v3/signin/identifier','email','new').browser.contexts()[0].pages()[0];
 const pages=[old];let created=0;const browser={contexts:()=>[{pages:()=>pages,newPage:async()=>{created++;pages.push(chosen);return chosen;}}]};
 const selection={};assert.equal((await openGoogleLogin(browser,selection)).stage,'email');
 assert.equal(selection.targetId,'new');await openGoogleLogin(browser,selection);
 assert.equal(created,1);assert.equal(pages.length,2);
});
test('other origins and verification/recovery screens never receive form input',async()=>{
 for(const url of ['http://accounts.google.com/v3/signin/identifier','https://accounts.google.com.evil.example/v3/signin/identifier','https://accounts.google.com/v3/signin/challenge/recaptcha','https://accounts.google.com/signin/recovery','https://flow.google.com/project/test']){
  const {browser,events}=fixture(url,'email');
  assert.equal((await readGoogleStage(browser)).stage,'manual');
  await assert.rejects(submitGoogleField(browser,{stage:'email',value:'fixture-only'}));
  assert.deepEqual(events,[]);
 }
});
test('a stale form step and ambiguous Google tabs cannot submit credentials',async()=>{
 const {browser,events}=fixture('https://accounts.google.com/v3/signin/challenge/pwd','password');
 await assert.rejects(submitGoogleField(browser,{stage:'email',value:'fixture-only'}));
 assert.deepEqual(events,[]);
 const page=browser.contexts()[0].pages()[0];
 const ambiguous={contexts:()=>[{pages:()=>[page,page]}]};
 assert.equal((await readGoogleStage(ambiguous)).stage,'manual');
 await assert.rejects(submitGoogleField(ambiguous,{stage:'password',value:'fixture-only'}));
});
