import {expect,it} from 'vitest';
import {forAspect,imageGuide} from './place-photos';
import {clipPrompts} from './pipeline';
it('selects only the requested orientation and preserves upload order and legacy portrait photos',()=>{
 const refs=[{slot:5,aspect:'16:9' as const,id:'inside-horizontal'},{slot:4,id:'legacy-portrait'},{slot:0,aspect:'16:9' as const,id:'street-horizontal'}];
 expect(forAspect(refs,'16:9').map(r=>r.id)).toEqual(['street-horizontal','inside-horizontal']);
 expect(forAspect(refs,'9:16').map(r=>r.id)).toEqual(['legacy-portrait']);
});
it('labels the exact selected image order and includes only the matching notes in the generated prompt',()=>{
 const refs=[{slot:4,aspect:'16:9' as const},{slot:0,aspect:'16:9' as const},{slot:7,aspect:'9:16' as const}],guide=imageGuide(refs,'16:9',{portrait:'portrait notes',landscape:'horizontal notes'});
 expect(guide).toContain('الصورة 1: قف عند باب');expect(guide).toContain('الصورة 2: قف أمام الباب من الداخل');expect(guide).toContain('horizontal notes');expect(guide).not.toContain('portrait notes');
 const form={name:'شركة',address:'عنوان',phone:'077000',products:'خدمات',prompt:'مشهد',instructions:'',model:'Veo 3.1 Fast',aspect:'16:9',duration:8,dialect:'العراقية',placeImageGuide:guide};
 expect(clipPrompts(form,1)[0]).toContain(guide);expect(imageGuide([],'9:16',{portrait:'notes',landscape:''})).toBe('');
});
