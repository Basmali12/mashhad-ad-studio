/* One pure contract shared by the planner and the trusted server. No inference. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ArabicDialogue=factory();})(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 const version='arabic-dialogue-v3-soundtrack';
 const fail=message=>{throw Error('ARABIC_DIALOGUE_REQUIRED: '+message);};
 const arabic=/[\u0621-\u063a\u0641-\u064a\u066e-\u06d3]/u;
 function validate(value,{silenceAllowed=true}={}){
  if(!value||typeof value!=='object'||Array.isArray(value))fail('جهّز تقريراً جديداً يتضمن النص العربي ومتحدث كل جملة؛ التقرير القديم محفوظ.');
  const dialect=value.dialect||'iraqi',mode=value.mode||'dialogue';
  if(value.language!==undefined&&value.language!=='ar')fail('لغة الحوار العربية إلزامية.');
  if(!['iraqi','msa','egyptian','gulf','levantine','maghrebi'].includes(dialect))fail('حدد لهجة عربية معروفة أو العربية الفصحى.');
  if(mode==='silent'){
   if(!silenceAllowed||value.silenceRequested!==true||!Array.isArray(value.lines)||value.lines.length)fail('الصمت يحتاج طلباً صريحاً، ولا يجتمع مع جمل منطوقة.');
   return {version,language:'ar',dialect,mode, silenceRequested:true,lines:[]};
  }
  if(mode!=='dialogue'||!Array.isArray(value.lines)||!value.lines.length||value.lines.length>3)fail('اكتب من جملة إلى ثلاث جمل عربية مكتملة لكل مشهد، مع المتحدث.');
  let total=0;
  const lines=value.lines.map(line=>{
   const speaker=typeof line?.speaker==='string'?line.speaker.trim():'',text=typeof line?.text==='string'?line.text.trim():'';
   if(speaker.length<2||speaker.length>180||/[\n\r\x00-\x1f«»"]/.test(speaker))fail('اسم المتحدث ووصفه مطلوبان لكل جملة.');
   if(!text||text.length>250||/[A-Za-z\n\r\x00-\x1f\u200b-\u200f\u202a-\u202e\u2066-\u2069«»"<>\[\]{}]/u.test(text)||!arabic.test(text)||[...text.matchAll(/\p{L}/gu)].some(m=>!arabic.test(m[0])))fail('الحوار يُكتب بحروف عربية واضحة؛ لا ترجمة لاتينية أو تعليمات داخل الجملة.');
   const words=text.replace(/[\u064b-\u065f\u0670\u0640]/gu,'').match(/[\u0621-\u063a\u0641-\u064a\u066e-\u06d3]+/gu)||[];
   if(!words.length||words.filter(w=>w.length===1).length>words.length/3||/(.)\1{4}/u.test(text))fail('الجملة مبعثرة أو تحتوي حروفاً مكررة؛ اكتب عبارة عربية طبيعية كاملة.');
   total+=words.length;return {speaker,text};
  });
  if(total>26)fail('الحوار أطول من مشهد عشر ثوانٍ؛ اختصره أو وزعه على المشاهد التالية.');
  return {version,language:'ar',dialect,mode,lines};
 }
 function compile(value){
  const c=validate(value);
  if(c.mode==='silent')return 'Only native location ambience and sounds caused by the visible action are audible. The characters remain silent throughout; there is no speech, singing or narration.';
  const dialect={iraqi:'natural Iraqi Arabic colloquial',msa:'Modern Standard Arabic',egyptian:'Egyptian Arabic',gulf:'Gulf Arabic',levantine:'Levantine Arabic',maghrebi:'Maghrebi Arabic'}[c.dialect];
  return ['The characters speak '+dialect+' naturally, with synchronized human voices and native action sounds.',
   ...c.lines.map(l=>l.speaker+' alone says aloud exactly: «'+l.text+'». The other characters listen with their mouths closed. Each speaker finishes before the next begins.'),
   'Only these Arabic words are heard in the soundtrack, once, without translation, paraphrasing or additional speech. Speaker descriptions are not spoken. Do not slow or stretch speech to fill the shot. After the final sentence, continue only the authored physical action, reactions and their native sounds without invented dialogue or an idle waiting pose. Preserve a deliberate pause only when the scene explicitly calls for it.'].join(' ');
 }
 function checkPrompt(prompt,value){
  const c=validate(value);
  // Authored quotations may repeat the locked lines, but cannot introduce a second script.
  for(const m of String(prompt).matchAll(/«([^»]*)»|"([^"\n]+)"/gu))if(!c.lines.some(l=>l.text===(m[1]??m[2]).trim()))fail('الوصف يحتوي كلاماً مقتبساً خارج الحوار المعتمد.');
  return c;
 }
 return {version,validate,compile,checkPrompt};
});
