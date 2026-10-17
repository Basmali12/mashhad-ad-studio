import type {SeriesProject} from './redesign-data';
export type EpisodeQuality='economy'|'balanced'|'quality';
export interface EpisodePolicy {maxCredits:number|null;quality:EpisodeQuality;allowWithinBudget:boolean;seconds:number;resolution:'720p'}
export const defaultEpisodePolicy:EpisodePolicy={maxCredits:null,quality:'balanced',allowWithinBudget:false,seconds:120,resolution:'720p'};
export function validateEpisodePolicy(policy:EpisodePolicy){
 if(policy.maxCredits!==null&&(!Number.isSafeInteger(policy.maxCredits)||policy.maxCredits<0))throw new Error('اكتب ميزانية صحيحة بوحدات Flow.');
 if(!['economy','balanced','quality'].includes(policy.quality)||policy.resolution!=='720p'||!Number.isSafeInteger(policy.seconds)||policy.seconds<10||policy.seconds>300)throw new Error('تحقق من جودة الحلقة ومدتها.');
 if(policy.allowWithinBudget&&policy.maxCredits===null)throw new Error('حدد أقصى ميزانية قبل التفويض.');
}
export function seriesMemory(project:SeriesProject){
 const policy=project.episodePolicy??defaultEpisodePolicy;validateEpisodePolicy(policy);
 const metadata=(file:File)=>({name:file.name,type:file.type,size:file.size,lastModified:file.lastModified});
 return {projectId:project.id,name:project.name,story:project.ticket?.story??'',instructions:project.instructions??'',conversationSummary:project.aiMemory??'',visualRequests:(project.visualRequests??[]).map(({id,kind,name,description,prompt,count,status,sourceRequestId})=>({id,kind,name,description,prompt,count,status,sourceRequestId})),locationReferences:(project.places??[]).map(place=>({id:place.id,name:place.name,description:place.description,references:place.references.map(r=>({id:r.id,label:r.label,image:metadata(r.file)}))})),characters:project.characters.map(c=>({id:c.id,name:c.name,description:c.description??project.messages?.find(m=>m.id===c.id)?.imageDetails?.description??'',image:metadata(c.image),approved:true})),places:(project.sceneImages??[]).map(s=>({id:s.id,name:s.name,description:s.description,image:metadata(s.image),approved:true})),episodes:(project.ticket?.episodes??[]).map((episode,index)=>({id:episode.id,number:index+1,summary:episode.summary,durationSeconds:episode.durationSeconds,completed:episode.completed,current:episode.id===project.ticket?.activeEpisodeId})),activeEpisodeId:project.ticket?.activeEpisodeId??null,selectedVideoModel:project.model?{...project.model,priceStatus:'saved-snapshot-recheck-before-generation'}:null,policy,endingVideo:project.endingVideo?{...metadata(project.endingVideo.file),durationSeconds:project.endingVideo.durationSeconds,position:'after-episode' as const,contentAnalyzed:false}:null};
}
export {SERIES_DIRECTOR_INSTRUCTIONS} from '../shared/series-director-instructions';
export function canExecuteEpisode(policy:EpisodePolicy,quote:{credits:number;observedAt:number;complete:boolean},explicitApproval:boolean,now:number){
 validateEpisodePolicy(policy);
 if(!quote.complete||!Number.isFinite(quote.credits)||quote.credits<0||quote.observedAt>now||now-quote.observedAt>3600000)return false;
 if(policy.maxCredits!==null&&quote.credits>policy.maxCredits)return false;
 return explicitApproval||(policy.allowWithinBudget&&policy.maxCredits!==null);
}


