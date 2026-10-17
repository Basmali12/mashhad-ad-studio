import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {URL} from 'node:url';
import {setImmediate} from 'node:timers';

test('confirmation stays clickable during polling, waits for it, and shows the result beside the button',async()=>{
 const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
 const source=html.split('<script type="module">')[1].split('try{\n const {publishableKey')[0];
 const elements=new Map();
 function element(id){if(!elements.has(id))elements.set(id,{textContent:id,hidden:false,disabled:false,dataset:{},querySelectorAll:()=>[],scrollIntoView(){this.scrolled=true;},replaceChildren(){},setAttribute(){}});return elements.get(id);}
 const panel=element('#google-panel');panel.querySelectorAll=()=>[element('#google-confirm'),element('#google-refresh')];
 let finishPoll;
 const poll=new Promise(resolve=>{finishPoll=resolve;});const calls=[];
 const context=vm.createContext({document:{querySelector:element,querySelectorAll:()=>[]},fetch:async path=>{calls.push(path);if(path==='./google-state')await poll;return {ok:true,json:async()=>path==='./confirm'?{ready:false,message:'افتح مشروع Flow واحدًا.'}:{stage:'manual',message:'أكمل تسجيل Google.'}};}});
 vm.runInContext(source,context);
 const pending=vm.runInContext('googleOperation(refreshGoogle,{background:true})',context);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(element('#google-confirm').disabled,false,'background polling must not flash or disable the confirmation button');
 const confirmation=element('#google-confirm').onclick();
 assert.equal(element('#google-confirm').disabled,true);
 assert.equal(element('#confirm').textContent,'جارٍ تأكيد حسابك…');
 assert.deepEqual(calls,['./google-state'],'confirmation must wait for the existing state request');
 assert.equal(element('#google-confirm').onclick(),undefined,'double click must not submit again');
 finishPoll();await pending;await confirmation;
 assert.deepEqual(calls,['./google-state','./confirm']);
 assert.equal(element('#google-status').textContent,'افتح مشروع Flow واحدًا.');
 assert.equal(element('#google-status').scrolled,true);
 assert.equal(element('#google-confirm').disabled,false);
 assert.equal(element('#confirm').disabled,false);
});
