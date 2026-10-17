import {expect,it} from 'vitest';
import {summarizeAdminJob} from './admin-overview';
const at=Date.parse('2026-10-17T12:00:00Z'),job={dueAt:at,dryRun:false,cancelled:false};
it('counts one success across multiple destinations only after all have receipts',()=>{
 const rows=['youtube','tiktok','facebook'].map(providerId=>({providerId,phase:'published',updatedAt:at}));
 expect(summarizeAdminJob(job,rows,at)).toMatchObject({published:1,todayPublished:1,upcoming:0});
 expect(summarizeAdminJob(job,[...rows,{phase:'accepted',updatedAt:at}],at).published).toBe(0);
 expect(summarizeAdminJob(job,[{phase:'published',updatedAt:at}],at).published).toBe(0);
});
it('uses Baghdad midnight and the final publication date, not the scheduled date',()=>{
 const end=Date.parse('2026-10-17T21:00:00Z');
 expect(summarizeAdminJob(job,[{phase:'published',providerId:'p',updatedAt:end-1}],at).todayPublished).toBe(1);
 expect(summarizeAdminJob(job,[{phase:'published',providerId:'p',updatedAt:end}],at).todayPublished).toBe(0);
 expect(summarizeAdminJob({...job,dueAt:end},[{phase:'queued',updatedAt:at}],at)).toMatchObject({todayScheduled:0,upcoming:1});
});
it('separates failures and ambiguous results from upcoming work',()=>{
 expect(summarizeAdminJob(job,[{phase:'failed',updatedAt:at},{phase:'published',providerId:'p',updatedAt:at}],at)).toMatchObject({failed:1,published:0,upcoming:0});
 expect(summarizeAdminJob(job,[{phase:'uncertain',updatedAt:at}],at)).toMatchObject({unresolved:1,published:0,upcoming:0});
});
it('excludes dry runs, cancelled jobs and empty jobs',()=>{
 const row=[{phase:'published',providerId:'p',updatedAt:at}];
 for(const value of [summarizeAdminJob({...job,dryRun:true},row,at),summarizeAdminJob({...job,cancelled:true},row,at),summarizeAdminJob(job,[],at)])expect(Object.values(value).every(n=>n===0)).toBe(true);
});
