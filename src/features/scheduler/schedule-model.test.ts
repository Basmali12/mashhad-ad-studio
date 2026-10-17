import {it,expect} from 'vitest';
import {nextPublishAt,manualPublishAt,addLibraryVideo} from './schedule-model';
import type {LibraryVideo} from './schedule-model';
const now=Date.parse('2026-10-15T00:00:00Z');
const row=(publishAt:string):LibraryVideo=>({id:publishAt,title:'حلقة',createdAt:1,publishAt});
it('uses the remaining second slot on the same Baghdad date, then advances to the next day',()=>{
 const schedule={times:['18:00','09:00'],timezone:'Asia/Baghdad' as const};
 const items=[row('2026-10-16T06:00:00Z')];
 const second=nextPublishAt(schedule,items,now);expect(second).toBe('2026-10-16T15:00:00.000Z');
 expect(nextPublishAt(schedule,[...items,row(second)],now)).toBe('2026-10-17T06:00:00.000Z');
});
it('skips past slots, handles month rollover, and rejects duplicate times and dates',()=>{
 const s={times:['09:00'],timezone:'Asia/Baghdad' as const};
 expect(nextPublishAt(s,[row('2026-10-31T06:00:00Z')],now)).toBe('2026-11-01T06:00:00.000Z');
 expect(nextPublishAt(s,[],Date.parse('2026-10-15T07:00:00Z'))).toBe('2026-10-16T06:00:00.000Z');
 expect(()=>nextPublishAt({...s,times:['09:00','09:00']},[],now)).toThrow();
 expect(()=>manualPublishAt('2026-10-16T09:00',[row('2026-10-16T06:00:00Z')],now)).toThrow('محجوز');
 expect(()=>manualPublishAt('2026-02-30T09:00',[],now)).toThrow();
});
it('keeps each series isolated and refuses duplicate or unfinished generated videos',()=>{
 const project={id:'a',name:'قصة',characters:[],videoRequests:[]};
 expect(()=>addLibraryVideo(project,{id:'v',title:'حلقة',videoRequestId:'job',createdAt:1},undefined,now)).toThrow('جاهز');
 const file=new File(['video'],'v.mp4',{type:'video/mp4'});
 const saved=addLibraryVideo(project,{id:'v',title:'حلقة',file,createdAt:1},undefined,now);
 expect(project).not.toHaveProperty('libraryVideos');expect(saved.libraryVideos).toHaveLength(1);
 expect(()=>addLibraryVideo(saved,{id:'v',title:'حلقة',file,createdAt:1},undefined,now)).toThrow('بالفعل');
});
it('assigns five videos to two daily slots starting tomorrow and keeps task order after moving a video',async()=>{
 const {reorderLibraryVideo}=await import('./schedule-model');
 let project:import('../../redesign-data').SeriesProject={id:'task-story',name:'مسلسل',characters:[],publishTasks:[{id:'t',name:'مهمة يومية',times:['08:00','14:00'],timezone:'Asia/Baghdad',createdAt:1,startDate:'2026-10-16'}]};
 for(let i=1;i<=5;i++)project=addLibraryVideo(project,{id:'v'+i,title:'الحلقة '+i,file:new File(['video'],'episode.mp4',{type:'video/mp4'}),createdAt:i,taskId:'t'},undefined,now);
 expect(project.libraryVideos?.map(v=>v.publishAt)).toEqual(['2026-10-16T05:00:00.000Z','2026-10-16T11:00:00.000Z','2026-10-17T05:00:00.000Z','2026-10-17T11:00:00.000Z','2026-10-18T05:00:00.000Z']);
 const reordered=reorderLibraryVideo(project,'v5','v1',now);
 expect(reordered.libraryVideos?.find(v=>v.id==='v5')?.publishAt).toBe('2026-10-16T05:00:00.000Z');
 expect(reordered.libraryVideos?.find(v=>v.id==='v1')?.publishAt).toBe('2026-10-16T11:00:00.000Z');
});
