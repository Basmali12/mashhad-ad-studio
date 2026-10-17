import {expect,it} from 'vitest';
import {trendFromReport,validateTrend,trendPrompt} from './trends';
import type {AnalysisReport} from './video-analysis';
const slot={key:'hero',label:'البطل',description:'استبدل الوجه'},recipe={slots:[slot],fixed:'المكان',variable:'الوجه',prompt:'Animate image 1.'};
it('supports one through four roles in order and rejects ambiguous slots',()=>{for(let n=1;n<=4;n++)expect(validateTrend({...recipe,slots:Array.from({length:n},(_,i)=>({...slot,key:`role-${i}`}))}).slots).toHaveLength(n);expect(()=>validateTrend({...recipe,slots:[]})).toThrow();expect(()=>validateTrend({...recipe,slots:[slot,slot]})).toThrow();expect(()=>validateTrend({...recipe,slots:Array.from({length:5},(_,i)=>({...slot,key:`role-${i}`}))})).toThrow();expect(trendPrompt(recipe)).toContain('Image 1: البطل');});
it('does not turn a story report into a made-up trend recipe',()=>{expect(()=>trendFromReport({} as AnalysisReport)).toThrow('تحليل قصة');expect(()=>trendPrompt({...recipe,prompt:'x'.repeat(8500)})).toThrow('اختصر');});
