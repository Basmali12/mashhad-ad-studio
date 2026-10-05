import {expect,it} from 'vitest';
import {flowDurations,defaultFlowOption,preferredFlowDurations} from './flow-options';
it('reads actual Flow RTL duration labels rather than falling back to the selected 8 seconds',()=>{expect(flowDurations(['\u202b4ث','\u202b6ث','\u202b8ث','\u202b10ث','720p','x1'],'فيديو 8ث')).toEqual([4,6,8,10]);expect(flowDurations([],'فيديو 720p 8ث')).toEqual([8]);expect(flowDurations(['\u206610 ث\u2069'],'8ث')).toEqual([10]);expect(flowDurations(['999ث'],'')).toEqual([])});
it('defaults only Omni to a verified 10-second option and preserves actual cost',()=>{
 expect(preferredFlowDurations('Omni Flash',[4,6,8,10])).toEqual([10,4,6,8]);expect(preferredFlowDurations('Veo 3.1 Fast',[8])).toEqual([8]);
 const base={model:'Omni Flash',actualModel:'Omni 1.1 Flash',aspect:'9:16',resolution:'720p' as const,seconds:8,cost:12};const ten={...base,seconds:10,cost:15};expect(defaultFlowOption([base,ten])).toEqual(ten);expect(defaultFlowOption([base])).toEqual(base);expect(defaultFlowOption([{...base,model:'Veo 3.1 Fast'},ten].filter(o=>o.model==='Veo 3.1 Fast'))?.seconds).toBe(8);
});
