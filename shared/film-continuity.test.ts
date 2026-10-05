import {expect,it} from 'vitest';
import {continuesScene,productionClips} from './film-production';
import type {FilmPlan} from './film-plan';
const scene={seconds:8,description:'النزول من الباص',dialogue:'',cast:['a','b'],place:'bus',continuity:'نفس آخر لقطة'};
const plan:FilmPlan={title:'الباص',synopsis:'لقاء',ending:'المشي',scenes:[scene,{...scene,description:'تتابع المشي',cast:['b','a']}]};
it('uses the last frame between consecutive scenes with the same place and cast',()=>{
 expect(continuesScene(plan,0)).toBe(false);expect(continuesScene(plan,1)).toBe(true);
 const clips=productionClips(plan,{model:'Omni Flash',actualModel:'Omni 1.1 Flash',seconds:8,resolution:'720p',aspect:'9:16',cost:12},[{_id:'a',kind:'character',name:'زهراء',description:'خيالية'},{_id:'b',kind:'character',name:'باسم',description:'خيالي'},{_id:'bus',kind:'place',name:'الباص',description:'رصيف'}],'واقعي','العراقية');
 expect(clips[0].prompt).not.toContain('استمر مباشرة من آخر إطار');expect(clips[1].prompt).toContain('استمر مباشرة من آخر إطار');
});
it('does not carry the previous frame into a different place or cast',()=>{
 for(const change of [{place:'home'},{cast:['a']},{continuity:''}])expect(continuesScene({...plan,scenes:[scene,{...scene,...change}]},1)).toBe(false);
});
