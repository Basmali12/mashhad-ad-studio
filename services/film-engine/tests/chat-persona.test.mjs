import test from 'node:test';
import assert from 'node:assert/strict';
import {OpenAIDirector} from '../engine/openai-director.mjs';
import {applyDiscussionOrientation} from '../engine/film-orientation.mjs';

test('discussion persona allows everyday chat, brands the application truthfully and declines coding without blocking creative software ads',async()=>{
 const records=new Map([['director-discussion',{seconds:20,style:'realistic',notes:'زينب تحافظ على محفظة صغيرة.'}]]);
 const store={get:async kind=>kind==='film-project'?{orientationConfirmed:false}:records.get(kind),put:async(kind,r)=>records.set(kind,r),open:()=>({key:'synthetic-test-only'}),audit:async()=>{}};
 const cases=[['من أنت؟','آني مساعد مشهد الذكي من شركة فن التقنية الحديثة، شلون أگدر أساعدك؟'],['اكتب كود واجهة تسجيل دخول','آسف، مساعد مشهد مو مخصص للبرمجة. أساعدك بالقصص والمحتوى.'],['شلونك اليوم؟','هلا بيك! شلون يومك؟']];
 let calls=0;
 const director=new OpenAIDirector(store,{fetcher:async(url,options)=>{
  const p=JSON.parse(options.body),[message,reply]=cases[calls++];
  assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(p.input.at(-1).content,message);
  for(const phrase of ['فن التقنية الحديثة','الدردشة اليومية','not a coding service','underlying model/provider','answer truthfully','A story/ad for a software company','Do not ask for film duration','separate image action and cost approval'])assert.ok(p.instructions.includes(phrase),phrase);
  assert.ok(p.instructions.lastIndexOf('Customer-facing Mashhad assistant policy')>p.instructions.indexOf('Cinematography policy'));
  assert.equal(p.store,false);assert.equal(p.text.format.name,'director_discussion');assert.equal(p.tools,undefined);
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply,intent:'discuss',orientation:null,proposed_duration_seconds:null,style:'',ready_to_write:true,missing:[],portrait_prompt:null,continuity_notes:''})}]}]});
 }});
 for(const [index,[message,reply]] of cases.entries()){
  const r={id:'persona-'+index,projectId:'story1',mode:'discuss'};
  await director.run(r,{messages:[{role:'user',content:message}],instruction:'Discuss the current message.',maxTokens:1600},{});
  assert.equal(r.status,'completed');assert.equal(r.discussion.reply,reply);assert.equal(r.discussion.ready_to_write,false);
  assert.equal(records.get('director-discussion').seconds,20);assert.equal(records.get('director-discussion').notes,'زينب تحافظ على محفظة صغيرة.');
  const p={orientationConfirmed:false};applyDiscussionOrientation(p,r.discussion,message);assert.equal(r.discussion.reply,reply);
 }
 assert.equal(calls,3);await director.close();
});

test('discussion persona does not replace production output with a conversational refusal',async()=>{
 const store={get:async()=>null,put:async()=>{},open:()=>({key:'synthetic-test-only'}),audit:async()=>{}};
 const director=new OpenAIDirector(store,{fetcher:async(url,options)=>{
  const p=JSON.parse(options.body);assert.equal(p.instructions.includes('Customer-facing Mashhad assistant policy'),false);assert.match(p.instructions,/exact sentence/);assert.equal(p.text.format.type,'json_object');
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"scenes":[]}'}]}]});
 }});
 const r={id:'production',projectId:'story1',mode:'details'};await director.run(r,{messages:[{role:'user',content:'إعلان لشركة برمجة'}],instruction:'Write scenes',maxTokens:6000},{});assert.equal(r.status,'completed');await director.close();
});

test('two independent conversations are accepted promptly and processed once without a busy rejection',async()=>{
 const records=new Map(),store={get:async(k,id)=>k==='config'?{credentials:{}}:records.get(k+':'+id),put:async(k,r)=>records.set(k+':'+r.id,{...r}),open:()=>({key:'synthetic-test-only'}),audit:async()=>{}};
 let release;const hold=new Promise(r=>release=r),calls=[];
 const director=new OpenAIDirector(store,{fetcher:async(url,options)=>{
  const p=JSON.parse(options.body);calls.push(p.input.at(-1).content);if(calls.length===1)await hold;
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'هلا بيك',intent:'discuss',proposed_duration_seconds:null,ready_to_write:false,continuity_notes:''})}]}]});
 }});
 try{
  const a={requestId:'a',projectId:'new-a',mode:'discuss',approvedTextCost:true,messages:[{role:'user',content:'هلو'}]},b={...a,requestId:'b',projectId:'new-b'};
  await director.submit(a);await director.submit(b);await director.submit(b);
  assert.equal((await director.get('b')).status,'queued');assert.deepEqual(calls,['هلو']);
  release();await Promise.all([...director.pending]);assert.deepEqual(calls,['هلو','هلو']);assert.equal((await director.get('b')).status,'completed');
 }finally{release();await director.close();}
});
