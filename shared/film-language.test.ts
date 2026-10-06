import {expect,it} from 'vitest';
import {PLAN_INSTRUCTIONS,planSchema,validatePlan,type FilmPlan} from './film-plan';
import {productionClips} from './film-production';
const refs=[{_id:'n',kind:'character',name:'نور',description:'Young Iraqi woman in a blue shirt',fileId:'noor-image'},{_id:'p',kind:'place',name:'الغرفة',description:'Quiet room'}];
const option={model:'Omni Flash',actualModel:'Omni 1.1 Flash',seconds:10,resolution:'360p' as const,aspect:'9:16',cost:7};
const plan:FilmPlan={promptLanguage:'en',title:'أول رسالة',synopsis:'نور تنتظر رسالة',ending:'نور تطمئن',scenes:[{seconds:10,description:'Medium shot. Noor turns toward the window, pauses, then smiles.',dialogue:'نور: هسه ارتاحيت، كلشي تمام.',cast:['n'],place:'p',continuity:'Keep the blue shirt and the same window position.'}]};
it('sends English action directions with verbatim Iraqi dialogue and owned reference order',()=>{
 const [clip]=productionClips(validatePlan(plan,10,refs),option,refs,'واقعي','العراقية');
 expect(clip.prompt).toContain('Action and camera: Medium shot. Noor turns');
 expect(clip.prompt).toContain('نور: هسه ارتاحيت، كلشي تمام.');
 expect(clip.prompt).toContain('Never translate dialogue into English');
 expect(clip.referenceIds).toEqual(['noor-image']);
 expect(clip.prompt).toContain('No extra people, heads');
 expect(clip.prompt).toContain('No text, subtitles, logos or overlays');
});
it('preserves saved Arabic plans and keeps English continuation tied to the previous last frame',()=>{
 const legacy={...plan,promptLanguage:undefined};
 expect(productionClips(legacy,option,refs,'واقعي','العراقية')[0].prompt).toContain('الأحداث والكاميرا');
 const clips=productionClips({...plan,scenes:[...plan.scenes,...plan.scenes]},option,refs,'واقعي','العراقية');
 expect(clips[1].prompt).toContain('Continue directly from the last frame');
 expect(clips[0].prompt).not.toContain('Continue directly from the last frame');
});
it('requests English production fields without translating the customer synopsis or dialogue',()=>{
 expect(planSchema.properties.promptLanguage.enum).toEqual(['en']);
 expect(PLAN_INSTRUCTIONS).toContain('description وcontinuity بالإنكليزية');
 expect(PLAN_INSTRUCTIONS).toContain('ولا تترجمه للإنكليزية');
 expect(()=>validatePlan({...plan,promptLanguage:'fr' as 'en'},10,refs)).toThrow('لغة تعليمات الإنتاج');
});
