import type {SeriesProject} from './redesign-data';
export interface PlaceReference {id:string;label:string;file:File}
export interface SeriesPlace {id:string;name:string;description:string;references:PlaceReference[];updatedAt:number}
export interface SceneDraft {description:string;prompt:string;durationSeconds:number;placeId:string|null;characterIds:string[];referenceImageIds:string[]}
export interface SceneSnapshot extends SceneDraft {id:string;episodeId:string;createdAt:number;instructions:string;place:{id:string;name:string;description:string}|null;references:PlaceReference[];characters:{id:string;name:string;description:string;image:File}[]}
export function snapshotScene(project:SeriesProject,episodeId:string,draft:SceneDraft):SceneSnapshot{
 const place=project.places?.find(p=>p.id===draft.placeId);
 if(draft.placeId&&!place)throw new Error('المساعد اختار مكانًا غير محفوظ. اطلب تصحيح خطة المشهد.');
 if(!Number.isInteger(draft.durationSeconds)||draft.durationSeconds<1||draft.durationSeconds>300)throw new Error('مدة المشهد غير صالحة.');
 const characters=draft.characterIds.map(id=>{const c=project.characters.find(c=>c.id===id);if(!c)throw new Error('المساعد اختار شخصية غير محفوظة.');return {id:c.id,name:c.name,description:c.description??'',image:c.image};});
 const references=draft.referenceImageIds.length?draft.referenceImageIds.map(id=>{const r=place?.references.find(r=>r.id===id);if(!r)throw new Error('مرجع الصورة لا ينتمي إلى مكان المشهد.');return {...r};}):(place?.references.map(r=>({...r}))??[]);
 return {...draft,characterIds:[...draft.characterIds],referenceImageIds:[...draft.referenceImageIds],id:crypto.randomUUID(),episodeId,createdAt:Date.now(),instructions:project.instructions??'',place:place?{id:place.id,name:place.name,description:place.description}:null,references,characters};
}
export function sceneGenerationInput(scene:SceneSnapshot,capabilities:{supportsReferenceImages:boolean;maxReferenceImages:number}){
 if(!Number.isInteger(capabilities.maxReferenceImages)||capabilities.maxReferenceImages<0)throw new Error('قدرات المزوّد غير صالحة.');
 const references=[...scene.characters.map(c=>({id:c.id,label:c.name,file:c.image})),...scene.references];
 const accepted=capabilities.supportsReferenceImages?references.slice(0,capabilities.maxReferenceImages):[];
 return {prompt:[scene.instructions,scene.place?`المكان: ${scene.place.name}\nالوصف الثابت: ${scene.place.description}`:'',scene.characters.map(c=>`الشخصية: ${c.name} — ${c.description}`).join('\n'),scene.description,scene.prompt].filter(Boolean).join('\n\n'),references:accepted,omittedReferenceIds:references.filter(r=>!accepted.some(a=>a.id===r.id)).map(r=>r.id),snapshotId:scene.id};
}
