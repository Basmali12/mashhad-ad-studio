import {describe,it,expect} from 'vitest';
import {applyAssistantAnswer,buildAssistantRequest} from './redesign-assistant';
import type {SeriesProject} from './redesign-data';
describe('project assistant persistence',()=>{
 it('keeps general chat context separate from project memory',async()=>{
  const conversation:SeriesProject={id:'general',kind:'conversation',name:'دردشة عامة',characters:[],aiMemory:'اتفاق سابق بالمحادثة',messages:[{id:'turn',role:'user',text:'كمل نقاشنا',createdAt:1}]};
  const payload=await buildAssistantRequest(conversation,'turn',async()=> '');
  expect(payload.memory.contextMode).toBe('general');expect(payload.memory.projectId).toBe('general');expect(payload.memory.conversationSummary).toBe('اتفاق سابق بالمحادثة');
  expect(payload.memory.characters).toEqual([]);expect(payload.memory.imagesIncluded).toEqual([]);
 });
 it('includes all approved references and current settings rather than limiting context to the first four images',async()=>{
  const file=new File(['test'],'portrait.png',{type:'image/png'});
  const project:SeriesProject={id:'one',name:'حكاية القرية',characters:Array.from({length:5},(_,i)=>({id:'character-'+i,name:'شخصية '+i,description:'الدور '+i,image:file,updatedAt:1})),sceneImages:[{id:'house',name:'بيت علي',description:'بيت ريفي',image:file,updatedAt:1}],aiMemory:'اتفاقات القصة',instructions:'بلا سيارات',model:{model:'veo',actualModel:'Veo Fast',seconds:8,resolution:'720p',cost:20,observedAt:1},episodePolicy:{maxCredits:300,quality:'balanced',allowWithinBudget:true,seconds:180,resolution:'720p'},endingVideo:{file:new File(['test'],'credits.mp4',{type:'video/mp4'}),durationSeconds:12},ticket:{story:'القصة المعتمدة',activeEpisodeId:'two',episodes:[{id:'two',summary:'عودة علي',durationSeconds:180,completed:false}]},messages:[{id:'turn',role:'user',text:'شنو اسم المشروع وشنو إعداداته؟',createdAt:1}]};
  const request=await buildAssistantRequest(project,'turn',async()=> 'data:image/jpeg;base64,AA==');
  expect(request.memory.contextMode).toBe('project');expect(request.memory.name).toBe('حكاية القرية');expect(request.memory.characters[4].description).toBe('الدور 4');expect(request.memory.imagesIncluded).toHaveLength(6);
  expect(request.messages.flatMap(m=>m.content).filter(c=>c.type==='input_image')).toHaveLength(6);
  expect(request.memory.selectedVideoModel).toMatchObject({actualModel:'Veo Fast',cost:20});expect(request.memory.policy.maxCredits).toBe(300);
  expect(request.memory.episodes[0]).toMatchObject({id:'two',durationSeconds:180,current:true});expect(request.memory.endingVideo).toMatchObject({name:'credits.mp4',durationSeconds:12,contentAnalyzed:false});
  const other=await buildAssistantRequest({id:'other',name:'مشروع جديد',characters:[],messages:[{id:'new',role:'user',text:'هلو',createdAt:1}]},'new',async()=> '');
  expect(other.memory.characters).toEqual([]);expect(other.memory.conversationSummary).toBe('');expect(other.memory.selectedVideoModel).toBeNull();expect(JSON.stringify(other)).not.toContain('بيت علي');
 });
 it('stores a reply once, proposes image metadata without approval, preserves completed episodes',()=>{
  const file=new File(['test'],'a.png',{type:'image/png'});
  const project:SeriesProject={id:'one',name:'الأول',characters:[],messages:[{id:'upload',role:'user',text:'',createdAt:1,image:file}],ticket:{story:'الأصل',episodes:[{id:'done',summary:'انتهت',durationSeconds:120,completed:true},{id:'next',summary:'قديم',durationSeconds:120,completed:false}]}};
  const answer={reply:'اقتراح الشخصية',memorySummary:'بطل القرية؛ مقترح غير معتمد',model:'gpt-5.6-sol',imageDetails:{kind:'character' as const,name:'علي',description:'راعي'},ticket:{story:'قصة جديدة',episodes:[{summary:'تغيير خاطئ',durationSeconds:120},{summary:'ثانية',durationSeconds:120}]}};
  const saved=applyAssistantAnswer(project,'upload',answer);
  expect(saved.messages?.[0].imageDetails?.name).toBe('علي');expect(saved.messages?.[0].imageApproved).toBeUndefined();expect(saved.characters).toEqual([]);
  expect(saved.ticket?.episodes[0]).toEqual(project.ticket?.episodes[0]);expect(saved.ticket?.episodes[1].summary).toBe('ثانية');expect(saved.aiMemory).toContain('غير معتمد');
  expect(applyAssistantAnswer(saved,'upload',answer)).toBe(saved);expect(project.messages).toHaveLength(1);
 });
});
