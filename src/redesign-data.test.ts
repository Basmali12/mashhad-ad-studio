import 'fake-indexeddb/auto';
import {it,expect} from 'vitest';
import {loadSeriesProjects,saveSeriesProject,deleteSeriesProject,newConversation,conversationTitle,type SeriesProject} from './redesign-data';
import {seriesMemory} from './redesign-director';

it('persists general conversations independently, starts fresh empty and deletes only the chosen chat',async()=>{
 const fresh=newConversation(),other=newConversation();
 expect(fresh.messages).toEqual([]);expect(fresh.id).not.toBe(other.id);
 const saved={...fresh,messages:[{id:'general-m',role:'user' as const,text:'مناقشة عامة',createdAt:1}],aiMemory:'قرار من المحادثة',updatedAt:2};
 await saveSeriesProject(saved);await saveSeriesProject(other);
 const reopened=(await loadSeriesProjects()).find(p=>p.id===saved.id)!;
 expect(reopened.kind).toBe('conversation');expect(reopened.messages).toEqual(saved.messages);expect(conversationTitle(reopened)).toBe('مناقشة عامة');
 await deleteSeriesProject(saved.id);
 expect((await loadSeriesProjects()).find(p=>p.id===other.id)).toEqual(other);
 expect(newConversation().aiMemory).toBeUndefined();
});

it('renames without losing context, refreshes the assistant name and deletes only the chosen project',async()=>{
 const original:SeriesProject={id:'rename-target',name:'قديم',characters:[],aiMemory:'الأحداث المعتمدة',messages:[{id:'m',role:'user',text:'حوار محفوظ',createdAt:1}]};
 const other:SeriesProject={id:'delete-neighbor',name:'مشروع آخر',characters:[]};
 await saveSeriesProject(original);await saveSeriesProject(other);
 await saveSeriesProject({...original,name:'حكاية علي'});
 const renamed=(await loadSeriesProjects()).find(p=>p.id===original.id)!;
 expect(renamed.messages).toEqual(original.messages);expect(renamed.aiMemory).toBe(original.aiMemory);expect(seriesMemory(renamed).name).toBe('حكاية علي');
 await deleteSeriesProject(original.id);
 const remaining=await loadSeriesProjects();expect(remaining.some(p=>p.id===original.id)).toBe(false);expect(remaining.find(p=>p.id===other.id)).toEqual(other);
});

it('reopens each project with its own conversation and story context while a new project starts empty',async()=>{
 const first:SeriesProject={id:'story-a',name:'القصة الأولى',characters:[],ticket:{story:'القصة المتفق عليها',episodes:[{id:'episode-1',summary:'أحداث الحلقة الأولى',durationSeconds:120,completed:true},{id:'episode-2',summary:'أحداث الحلقة الثانية',durationSeconds:120,completed:false}],activeEpisodeId:'episode-2'},instructions:'قصة ريفية عن علي',messages:[{id:'message-a',role:'user',text:'علي يدخل القرية',createdAt:1}],model:{model:'Omni Flash',actualModel:'Omni 1.1 Flash',seconds:10,resolution:'360p',cost:7,observedAt:1}};
 await saveSeriesProject(first);
 await saveSeriesProject({id:'story-b',name:'قصة جديدة',characters:[]});
 let reopened=await loadSeriesProjects();
 expect(reopened.find(p=>p.id==='story-a')).toEqual(first);
 expect(reopened.find(p=>p.id==='story-b')?.messages??[]).toEqual([]);
 expect(reopened.find(p=>p.id==='story-b')?.ticket).toBeUndefined();
 expect(reopened.find(p=>p.id==='story-b')?.instructions??'').toBe('');
 await saveSeriesProject({...reopened.find(p=>p.id==='story-b')!,instructions:'قصة ثانية',messages:[{id:'message-b',role:'user',text:'قصة أخرى',createdAt:2}]});
 reopened=await loadSeriesProjects();
 expect(reopened.find(p=>p.id==='story-a')).toEqual(first);
 expect(reopened.find(p=>p.id==='story-b')?.messages?.[0].text).toBe('قصة أخرى');
});

