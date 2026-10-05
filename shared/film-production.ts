import type {FilmPlan} from './film-plan';
import type {FlowOption} from './pipeline';
// A new scene can continue the same shot only when its place and cast match.
export function continuesScene(plan:FilmPlan,sceneIndex:number){
 const current=plan.scenes[sceneIndex],previous=plan.scenes[sceneIndex-1];
 return !!current&&!!previous&&!!current.continuity.trim()&&current.place===previous.place&&current.cast.length===previous.cast.length&&current.cast.every(id=>previous.cast.includes(id));
}
export const filmPhases={queued:'بانتظار الإنتاج',generating:'التوليد',downloading:'التنزيل',reviewing:'مراجعة المشهد',ready:'المقاطع جاهزة للدمج',montage:'المونتاج',verifying:'التحقق',uploading:'الرفع',completed:'مكتمل',failed:'فشل',login:'يحتاج تسجيل دخول',uncertain:'يحتاج تحقق من الإرسال',stopped:'متوقف'} as const;
export function partDialogue(dialogue:string,start:number,target:number,seconds:number,names:string[]){
 const escaped=names.map(n=>n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')),pattern=escaped.length?new RegExp(`(${escaped.join('|')})\\s*:`,'gu'):null,matches=pattern?[...dialogue.matchAll(pattern)]:[];
 const turns=matches.length?matches.map((m,i)=>({speaker:m[1],text:dialogue.slice(m.index!+m[0].length,matches[i+1]?.index??dialogue.length)})):[{speaker:'الحوار المعتمد',text:dialogue}];
 const words=turns.flatMap(t=>t.text.trim().split(/\s+/).filter(Boolean).map(word=>({speaker:t.speaker,word})));if(words.length>seconds*3)throw new Error('الحوار طويل لزمن المشهد؛ اختصره قبل الإنتاج.');
 const slice=words.slice(Math.min(words.length,Math.floor(start*3)),Math.min(words.length,Math.floor((start+target)*3))),parts:{speaker:string;text:string}[]=[];for(const w of slice){const last=parts.at(-1);if(last?.speaker===w.speaker)last.text+=' '+w.word;else parts.push({speaker:w.speaker,text:w.word});}return parts.map(p=>`${p.speaker}: ${p.text}`).join('\n')||'دون كلام في هذا الجزء.';
}
export function productionClips(plan:FilmPlan,option:FlowOption,refs:{_id:string;kind:string;name:string;description:string;fileId?:string}[],style:string,dialect:string){
 if(!Number.isSafeInteger(option.seconds)||option.seconds<1||option.seconds>30||!['9:16','16:9'].includes(option.aspect)||!Number.isFinite(option.cost)||option.cost<0)throw new Error('خيارات الإنتاج غير صالحة.');
 const clips=plan.scenes.flatMap((scene,sceneIndex)=>Array.from({length:Math.ceil(scene.seconds/option.seconds)},(_,part)=>{
  const cast=refs.filter(r=>scene.cast.includes(r._id)),place=refs.find(r=>r._id===scene.place);
  if(!place||cast.length!==scene.cast.length)throw new Error('مراجع المشهد غير مكتملة.');
  const start=part*option.seconds,target=Math.min(option.seconds,scene.seconds-start),dialogue=partDialogue(scene.dialogue,start,target,scene.seconds,cast.map(r=>r.name));
  return {scene:sceneIndex,part,target,referenceIds:[...cast,place].flatMap(r=>r.fileId?[r.fileId]:[]),prompt:`فيلم ${style}، باللهجة ${dialect}. عنوان الحلقة: ${plan.title}.\nالمشهد ${sceneIndex+1}، الجزء ${part+1}؛ نفّذ الأحداث المناسبة من الثانية ${start} إلى ${start+target} لهذا المشهد، في مقطع مصدر مدته ${option.seconds} ثانية.\nالأحداث والكاميرا: ${scene.description}\nالحوار الصوتي لهذا الجزء فقط ومن يتكلم: ${dialogue}\nلا تعِد حوار الجزء السابق. أكمل أحداث هذا الجزء وحواره ضمن أول ${target} ثانية؛ ما بعدها لقطة صامتة مستقرة، لأن المونتاج يحتفظ بأول ${target} ثانية فقط. لا تُسرّع الحركة أو الكلام بصورة غير طبيعية.\nطاقم الظهور الحصري: ${cast.map(r=>`${r.name}: ${r.description}`).join('؛ ')||'دون أشخاص'}.\nالمكان: ${place.name}: ${place.description}\nالاستمرارية: ${scene.continuity}\nالتزم بصورة مرجع كل شخصية وصوتها وعمرها وملابسها؛ لا تضف شخصًا أو رأسًا أو كتفًا أو ظل إنسان غير مطلوب، ولا تبدل النوع أو الملامح. دون كتابة أو ترجمة أو شعار أو علامة فوق الصورة. ${part||continuesScene(plan,sceneIndex)?'استمر مباشرة من آخر إطار للمقطع السابق، دون إعادة بداية المشهد.':'ابدأ هذا المشهد حسب المراجع المعتمدة؛ حافظ على هوية القصة.'}`};
 }));
 if(!clips.length||clips.length>80||plan.scenes.reduce((n,s)=>n+s.seconds,0)>300)throw new Error('الحد 80 مقطعًا و300 ثانية للحلقة.');return clips;
}
export function filmFailure(e:unknown){return String(e instanceof Error?e.message:e).replace(/(?:https?|wss?):\/\/\S+/g,'[URL]').replace(/Bearer\s+\S+|sk-[\w-]+/gi,'[secret]').slice(0,900);}
