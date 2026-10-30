import test from 'node:test';
import assert from 'node:assert/strict';
import {visualWorld,mergeVisualWorld,visualScene} from '../engine/visual-world.mjs';
import {OpenAIDirector} from '../engine/openai-director.mjs';
const setting=(id,era,location)=>({id,era,location,architecture:era==='heritage'?'Shanashil balconies, old brick and timber':era==='contemporary'?'Modern glass and steel office, plain walls':'User-requested materials',wardrobe:'Agreed clothing',lighting:'Motivated window light',palette:'Natural colors'});
const world=()=>visualWorld({style:'Cinematic realism',settings:[setting('old_street','heritage','Historical Baghdad street'),setting('studio','contemporary','Present-day software studio')],characters:[{id:'hasan',description:'Young man with short black hair, olive shirt'}],props:[{id:'wallet',description:'Small brown leather pocket wallet, no strap'}]});
test('heritage and modern scenes coexist, selected setting is applied without globally erasing either style',()=>{
 const w=world(),base={prompt:'He notices the wallet and lifts it once.',characterIds:['hasan'],propIds:['wallet'],continuity:{before:'Wallet on the ground',after:'Wallet in his right hand'}};
 const old=visualScene({...base,settingId:'old_street'},w),modern=visualScene({...base,settingId:'studio'},w);
 assert.match(old.prompt,/Shanashil/);assert.match(old.prompt,/do not modernize/);assert.ok(!old.prompt.includes('Modern glass'));
 assert.match(modern.prompt,/Present-day software studio/);assert.ok(!modern.prompt.includes('Shanashil'));assert.match(modern.prompt,/do not age/i);
 assert.match(modern.prompt,/Small brown leather pocket wallet/);assert.match(modern.prompt,/Wallet in his right hand/);assert.match(modern.prompt,/short black hair/);
 assert.equal(old.visualContext.era,'heritage');assert.equal(modern.visualContext.era,'contemporary');
});
test('old building in the present remains contemporary and unspecified era never defaults to a historical year',()=>{
 const w=visualWorld({style:'Realistic',settings:[{...setting('home','contemporary','An old house in present-day Baghdad'),architecture:'Weathered brick house next to current traffic'}]});
 const p=visualScene({prompt:'A visitor enters.'},w);assert.match(p.prompt,/old building can still exist in the present day/);assert.equal(p.visualContext.era,'contemporary');
 const unknown=visualWorld({style:'Realistic',settings:[setting('city','unspecified','User-approved city')]});assert.match(visualScene({prompt:'A visitor walks.'},unknown).prompt,/period is unspecified/);
 assert.deepEqual(visualScene({prompt:'Existing legacy scene'},null),{prompt:'Existing legacy scene',visualContext:null});
});
test('later batches retain established character, prop and setting descriptions while allowing a planned location transition',()=>{
 const w=world(),next=mergeVisualWorld(w,{style:'Unexpected cartoon replacement',settings:[{...setting('old_street','contemporary','Wrong replacement')} ,setting('future_city','futuristic','A planned future city')],characters:[{id:'hasan',description:'Wrong replacement face'}],props:[{id:'wallet',description:'Large bag'}]});
 assert.equal(next.style,w.style);assert.equal(next.settings[0].era,'heritage');assert.equal(next.characters[0].description,w.characters[0].description);assert.equal(next.props[0].description,w.props[0].description);
 assert.match(visualScene({prompt:'A time traveller arrives.',settingId:'future_city'},next).prompt,/future-world/);assert.deepEqual(w,world());
});
test('unknown scene IDs, duplicate settings and invalid descriptions are rejected; arbitrary adapter paths do not reach the prompt',()=>{
 const w=world();assert.throws(()=>visualScene({prompt:'Scene',settingId:'missing'},w),/SETTING_REQUIRED/);
 assert.throws(()=>visualScene({prompt:'Scene',settingId:'studio',characterIds:['not-known']},w),/INVALID_VISUAL_WORLD/);
 assert.throws(()=>visualWorld({style:'Realistic',settings:[setting('same','heritage','a'),setting('same','contemporary','b')]}),/INVALID_VISUAL_WORLD/);
 const value=visualScene({prompt:'Scene',settingId:'studio',loraPath:'/private/unapproved.safetensors'},w);assert.ok(!JSON.stringify(value).includes('unapproved.safetensors'));
});
test('real director payload carries the world policy for planning and preserves heritage choice in discussion, with offline provider only',async()=>{
 const payloads=[],store={get:async()=>null,put:async()=>{},audit:async()=>{},open:()=>({key:'synthetic-only'})};
 const director=new OpenAIDirector(store,{fetcher:async(_url,options)=>{payloads.push(JSON.parse(options.body));return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"scenes":[]}'}]}]});}});
 await director.run({id:'world-plan',projectId:'project',mode:'details'},{messages:[{role:'user',content:'فيلم قديم بشناشيل بغداد'}],instruction:'Return a scene plan',maxTokens:6000},{});
 assert.match(payloads[0].instructions,/visualWorld:/);assert.match(payloads[0].instructions,/never remove it globally/);assert.equal(payloads[0].instructions.match(/Also return visualWorld:/g).length,1);assert.equal(payloads[0].max_output_tokens,6000);
 await director.close();
});
