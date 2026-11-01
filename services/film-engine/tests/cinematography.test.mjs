import test from 'node:test';
import assert from 'node:assert/strict';
import {OpenAIDirector} from '../engine/openai-director.mjs';
import {prepareBrief} from '../engine/prompt-planner.mjs';

test('all director modes send camera guidance without changing schemas, dialogue or approval flow',async()=>{
 const records=new Map();let calls=0;
 const store={get:async()=>null,put:async(k,v)=>records.set(k,v),audit:async()=>{},open:()=>({key:'synthetic-test-only'})};
 const director=new OpenAIDirector(store,{fetcher:async(url,options)=>{
  calls++;assert.equal(url,'https://api.openai.com/v1/responses');
  const p=JSON.parse(options.body);
  for(const phrase of ['shot size','motivated light source','720p','exact sentence','Arabic','configured engine audio','event before the reaction','without adding fields'])assert.ok(p.instructions.includes(phrase),phrase);
  assert.equal(p.store,false);assert.equal(p.max_output_tokens,6000);
  assert.equal(p.input.at(-1).content,'إعلان عراقي، بإضاءة طبيعية وكاميرا ثابتة');
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'نناقش المدة أولاً',proposed_duration_seconds:30,style:'واقعي',ready_to_write:false,missing:[],portrait_prompt:null,continuity_notes:''})}]}]});
 }});
 for(const mode of ['discuss','brief','outline','details']){
  const r={id:'test-'+mode,projectId:'synthetic-project',mode};
  await director.run(r,{messages:[{role:'user',content:'إعلان عراقي، بإضاءة طبيعية وكاميرا ثابتة'}],instruction:'Preserve output schema',maxTokens:6000},{});
  assert.equal(r.status,'completed');
  if(mode==='discuss')assert.equal(r.discussion.ready_to_write,false);
 }
 assert.equal(calls,4);await director.close();
});

test('offline commercial brief contains concrete camera/light guidance and preserves exact dialogue',()=>{
 const brief=prepareBrief({request:'اعلان عراقي عن شركة برمجة',dialogue:'ويّانا فكرتك تصير حقيقة.',brand:'فن التقنية الحديثة'});
 assert.match(brief.compiledPrompt,/35mm/);assert.match(brief.compiledPrompt,/smooth tracking/);
 assert.match(brief.compiledPrompt,/motivated soft cinematic lighting/);
 assert.match(brief.compiledPrompt,/configured 720p/);
 assert.ok(brief.compiledPrompt.includes('ويّانا فكرتك تصير حقيقة.'));
 assert.equal(brief.paid,false);assert.equal(brief.timeline.length,3);
});
