import {expect,it} from 'vitest';
import {parseAnalysis,ANALYSIS_INSTRUCTIONS} from './video-analysis';
const report={summary:'قصة',characters:[{key:'a',name:'نور',role:'البطلة',appearance:'سترة زرقاء'}],places:[],shots:[{start:0,end:10,action:'نور تتكلم',camera:'قريبة',lighting:'دافئة',speakers:['a'],dialogue:'كلام غير مؤكد',audioClear:true}],uncertainties:[]};
it('does not retain an unconfirmed audio transcript and escalates its time range',()=>{const r=parseAnalysis(JSON.stringify({...report,shots:[{...report.shots[0],audioClear:false}]}),10);expect(r.shots[0].dialogue).toBe('');expect(r.uncertainties).toEqual([{start:0,end:10,reason:'الصوت أو هوية المتكلم غير واضحة.'}]);expect(ANALYSIS_INSTRUCTIONS).toContain('FROM AUDIBLE AUDIO ONLY');expect(ANALYSIS_INSTRUCTIONS).toContain('NEVER use subtitles');});
it('detects missing coverage independently of model confidence',()=>{const r=parseAnalysis(JSON.stringify(report),30);expect(r.uncertainties).toContainEqual({start:10,end:30,reason:'نهاية الفيديو لم تُحلل بالكامل.'});});
it('rejects invalid timestamps and a speaker absent from the character list',()=>{expect(()=>parseAnalysis(JSON.stringify({...report,shots:[{...report.shots[0],end:40}]}),10)).toThrow();expect(()=>parseAnalysis(JSON.stringify({...report,shots:[{...report.shots[0],speakers:['unknown']}]}),10)).toThrow('المتكلم');});

it('keeps an off-screen narrator separate from the visible character and recognizes the later dialogue turn',()=>{
 const r=parseAnalysis(JSON.stringify({...report,narrators:[{key:'narrator',voiceDescription:'رجل يروي القصة'}],visual:{style:'anime',rendering:'2d',period:'قديم',evidence:'خطوط مرسومة'},shots:[{...report.shots[0],speakers:['a'],speech:[{start:0,end:4,kind:'narrator',speakerKey:'narrator',text:'في قرية بعيدة'},{start:4,end:10,kind:'character',speakerKey:'a',text:'هلا بيك'}]}]}),10);
 expect(r.narrators).toHaveLength(1);expect(r.characters).toHaveLength(1);expect(r.shots[0].speech?.map(t=>t.kind)).toEqual(['narrator','character']);expect(r.visual?.style).toBe('anime');
});
it('rejects a narrator wrongly bound to a character key and escalates an unresolved voice',()=>{
 const shot={...report.shots[0],speech:[{start:0,end:10,kind:'narrator',speakerKey:'a',text:'تعليق'}]};expect(()=>parseAnalysis(JSON.stringify({...report,shots:[shot]}),10)).toThrow('الناطق');
 const r=parseAnalysis(JSON.stringify({...report,shots:[{...shot,speech:[{...shot.speech[0],kind:'unknown',speakerKey:''}]}]}),10);expect(r.uncertainties[0].reason).toContain('هوية الصوت');
});
it('drops all speech segments when audio is unclear, including narrator text',()=>{
 const r=parseAnalysis(JSON.stringify({...report,narrators:[{key:'voice',voiceDescription:'صوت رجل'}],shots:[{...report.shots[0],audioClear:false,speech:[{start:0,end:10,kind:'narrator',speakerKey:'voice',text:'غير مؤكد'}]}]}),10);expect(r.shots[0].speech).toEqual([]);expect(r.shots[0].dialogue).toBe('');
});
