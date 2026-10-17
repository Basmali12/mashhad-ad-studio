import {it,expect} from 'vitest';
import {canExecuteEpisode,defaultEpisodePolicy,seriesMemory} from './redesign-director';
it('requires current complete prices and never lets approval override the budget ceiling',()=>{
 const policy={...defaultEpisodePolicy,maxCredits:100,allowWithinBudget:true};
 expect(canExecuteEpisode(policy,{credits:90,observedAt:1000,complete:true},false,2000)).toBe(true);
 expect(canExecuteEpisode(policy,{credits:101,observedAt:1000,complete:true},true,2000)).toBe(false);
 expect(canExecuteEpisode(policy,{credits:90,observedAt:1000,complete:false},true,2000)).toBe(false);
 expect(canExecuteEpisode(policy,{credits:90,observedAt:1000,complete:true},true,3601001)).toBe(false);
 expect(canExecuteEpisode(defaultEpisodePolicy,{credits:90,observedAt:1000,complete:true},false,2000)).toBe(false);
});
it('builds memory only from the selected project and respects agreed duration without a fixed ending allocation',()=>{
 const memory=seriesMemory({id:'p',name:'قصة علي',characters:[{id:'ali',name:'علي',image:new File(['x'],'ali.png'),updatedAt:1}],ticket:{story:'القصة المعتمدة',episodes:[{id:'e',summary:'آخر أحداث القصة',durationSeconds:120,completed:true}]},episodePolicy:{...defaultEpisodePolicy,seconds:180}});
 expect(memory.policy.seconds).toBe(180);expect(memory.episodes[0].summary).toBe('آخر أحداث القصة');expect(memory.characters[0]).toMatchObject({id:'ali',name:'علي',approved:true,image:{name:'ali.png'}});
});
