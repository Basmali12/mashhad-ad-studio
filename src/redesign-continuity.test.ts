import 'fake-indexeddb/auto';
import {it,expect} from 'vitest';
import {snapshotScene,sceneGenerationInput,type SceneDraft} from './redesign-continuity';
import {saveSeriesProject,loadSeriesProjects,type SeriesProject} from './redesign-data';
import {buildAssistantRequest,applyAssistantAnswer} from './redesign-assistant';
const draft:SceneDraft={description:'علي يدخل البيت',prompt:'لقطة دخول عبر الباب الأزرق',durationSeconds:120,placeId:'home',characterIds:['ali'],referenceImageIds:['outside']};
function project():SeriesProject{return {id:'continuity',name:'حكاية بغداد',instructions:'بغداد سنة 1995، بدون هواتف ذكية',characters:[{id:'ali',name:'علي',description:'طالب يرتدي قميصًا أبيض',image:new File(['character'],'ali.png',{type:'image/png'}),updatedAt:1}],places:[{id:'home',name:'منزل العائلة',description:'باب أزرق والغرفة على اليمين',updatedAt:1,references:[{id:'outside',label:'واجهة المنزل',file:new File(['outside'],'outside.png',{type:'image/png'})},{id:'inside',label:'غرفة الجلوس',file:new File(['inside'],'inside.png',{type:'image/png'})}]}]};}
it('preserves the exact scene context after editing or deleting current settings and reopening storage',async()=>{
 const original=project(),scene=snapshotScene(original,'episode',draft);
 await saveSeriesProject({...original,instructions:'تعليمات جديدة',places:[],characters:[],sceneHistory:[scene]});
 const stored=(await loadSeriesProjects()).find(p=>p.id===original.id)!;
 expect(stored.sceneHistory?.[0].instructions).toBe(original.instructions);expect(stored.sceneHistory?.[0].place?.description).toContain('باب أزرق');expect(stored.sceneHistory?.[0].references.map(r=>r.id)).toEqual(['outside']);expect(stored.sceneHistory?.[0].characters[0].name).toBe('علي');
 const generation=sceneGenerationInput(scene,{supportsReferenceImages:true,maxReferenceImages:2});
 expect(generation.prompt).toContain('1995');expect(generation.prompt).not.toContain('تعليمات جديدة');expect(generation.references.map(r=>r.id)).toEqual(['ali','outside']);
 expect(sceneGenerationInput(scene,{supportsReferenceImages:false,maxReferenceImages:0}).omittedReferenceIds).toEqual(['ali','outside']);
 expect(()=>snapshotScene(original,'episode',{...draft,referenceImageIds:['not-from-place']})).toThrow();
});
it('sends fixed instructions and every place reference to planning and records scene snapshots without allowing AI edits',async()=>{
 const original={...project(),messages:[{id:'turn',role:'user' as const,text:'خطط الحلقة',createdAt:1}]};
 const payload=await buildAssistantRequest(original,'turn',async()=> 'data:image/jpeg;base64,AA==');
 expect(payload.memory.instructions).toBe(original.instructions);expect(payload.memory.locationReferences[0].references.map(r=>r.id)).toEqual(['outside','inside']);expect(payload.memory.imagesIncluded.map(r=>r.id)).toContain('inside');
 const answer={reply:'الخطة',memorySummary:'ملخص',model:'test',imageDetails:null,ticket:{story:'حكاية',episodes:[{summary:'الحلقة الأولى',durationSeconds:120,scenes:[draft]}]}};
 const saved=applyAssistantAnswer(original,'turn',answer);
 expect(saved.instructions).toBe(original.instructions);expect(saved.ticket?.episodes[0].sceneIds).toEqual([saved.sceneHistory?.[0].id]);expect(saved.sceneHistory?.[0].references).toHaveLength(1);
 const conflict=applyAssistantAnswer(original,'turn',{...answer,conflict:'الهاتف الذكي يتعارض مع سنة 1995'});
 expect(conflict.ticket).toBeUndefined();expect(conflict.sceneHistory).toHaveLength(0);expect(conflict.instructions).toBe(original.instructions);
 expect(()=>applyAssistantAnswer(original,'turn',{...answer,ticket:{story:'حكاية',episodes:[{summary:'حلقة',durationSeconds:120,scenes:[{...draft,durationSeconds:8}]}]}})).toThrow('مدد المشاهد');
});
