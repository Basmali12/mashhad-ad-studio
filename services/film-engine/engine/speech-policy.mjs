import {Buffer} from 'node:buffer';
export const SPEECH_EXPRESSIONS=Object.freeze(['neutral','whispers','excited','laughs','sighs','curious','sarcastic','exhales','mischievously']);
const direction={همس:'whispers','يتكلم بهمس':'whispers',حماس:'excited','يتكلم بحماس':'excited',ضحك:'laughs',تنهد:'sighs',فضول:'curious',سخرية:'sarcastic'};
export function speechExpression(value='neutral'){
 const input=String(value??'neutral'),name=direction[input]??input.replace(/^\[|\]$/g,'');if(!SPEECH_EXPRESSIONS.includes(name))throw Error('SPEECH_EXPRESSION_UNSUPPORTED');return name;
}
export function selectSpeechModel({locale,profile=null,modelId=null,expression='neutral'}){
 const dialect={'ar-IQ':'habibi-irq','ar-EG':'habibi-egy','ar-MSA':'habibi-msa'},requested=modelId??profile?.modelId??dialect[locale];
 if(profile&&(profile.locale!==locale||modelId&&profile.modelId!==modelId))throw Error('VOICE_PROFILE_CHANGED');
 const emotion=speechExpression(expression);if(requested==='audar-tts-v1-flash'){if(!['ar','en'].includes(locale))throw Error('SPEECH_DIALECT_UNVERIFIED');}
 else if(requested!==dialect[locale])throw Error('SPEECH_DIALECT_UNSUPPORTED');
 if(requested!=='audar-tts-v1-flash'&&emotion!=='neutral')throw Error('SPEECH_EXPRESSION_UNSUPPORTED');
 return requested;
}
export function splitSpeechText(text,{modelId,pauses=[]}={}){
 if(typeof text!=='string'||!text.trim()||text.length>30000||/\[[^\]]+\]/.test(text)||!Array.isArray(pauses)||pauses.length>1000)throw Error('SPEECH_TEXT_INVALID');
 const limits=modelId==='audar-tts-v1-flash'?{chars:200,bytes:1200}:{chars:120,bytes:120},pauseMap=new Map();
 for(const p of pauses){if(!p||!Number.isSafeInteger(p.afterOffset)||p.afterOffset<1||p.afterOffset>text.length||!Number.isSafeInteger(p.durationMs)||p.durationMs<0||p.durationMs>5000||pauseMap.has(p.afterOffset)||p.afterOffset<text.length&&!/[\s.,!?،؛؟]/u.test(text[p.afterOffset-1])&&!/\s/u.test(text[p.afterOffset]))throw Error('SPEECH_PAUSE_INVALID');pauseMap.set(p.afterOffset,p.durationMs);}
 const parts=[];let start=0;
 while(start<text.length){let end=start,boundary=0,sentence=0;
  for(const cp of text.slice(start)){const next=end+cp.length;if(next-start>limits.chars||Buffer.byteLength(text.slice(start,next),'utf8')>limits.bytes)break;end=next;if(/[\s.,!?،؛؟]/u.test(cp))boundary=end;if(/[.!?؛؟]/u.test(cp))sentence=end;if(pauseMap.has(end)){boundary=end;sentence=end;break;}}
  if(end<text.length)end=sentence||boundary;if(end<=start)throw Error('SPEECH_WORD_TOO_LONG');
  const fragment=text.slice(start,end);if(!fragment.trim())throw Error('SPEECH_TEXT_INVALID');parts.push({index:parts.length,text:fragment,startOffset:start,endOffset:end,pauseAfterMs:pauseMap.get(end)??0});start=end;
 }
 if(parts.length>1000||[...pauseMap.keys()].some(offset=>!parts.some(p=>p.endOffset===offset)))throw Error('SPEECH_PAUSE_INVALID');return parts;
}
export function prepareSpeechStoryboard(plan){
 const result={...plan,utterances:plan.utterances.map(u=>{
  const speaker=u.narratorId?plan.narrators.find(n=>n.id===u.narratorId):plan.characters.find(c=>c.id===u.characterId);if(!speaker)throw Error('VOICE_SPEAKER_INVALID');
  const expression=speechExpression(u.expression);selectSpeechModel({locale:speaker.voice.locale,modelId:speaker.voice.engineId,expression});
  if(u.role==='vocal_event'&&!u.text.replace(/\[[^\]]*\]/g,'').trim())throw Error('SPEECH_VOCAL_EVENT_UNSUPPORTED');
  return {...u,expression,speechChunks:splitSpeechText(u.text,{modelId:speaker.voice.engineId,pauses:u.speechPauses??[]})};
 })};return result;
}
