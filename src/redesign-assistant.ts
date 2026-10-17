import {seriesMemory} from './redesign-director';
import {studioChat} from './retired-studio-api';
import {addVisualProposal,type VisualProposal} from './redesign-visual';
import {snapshotScene,type SceneDraft} from './redesign-continuity';
import type {SeriesProject,SeriesMessage} from './redesign-data';
export interface AssistantAnswer {reply:string;memorySummary:string;model:string;imageDetails:SeriesMessage['imageDetails']|null;ticket:{story:string;episodes:{summary:string;durationSeconds:number;scenes?:SceneDraft[]}[]}|null;conflict?:string|null;imageRequest?:VisualProposal|null;videoRequest?:import('../shared/chat-video').ChatVideoProposal|null}
export async function imageData(file:File){
 const bitmap=await createImageBitmap(file);
 try{const scale=Math.min(1,1024/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const context=canvas.getContext('2d');if(!context)throw new Error('تعذر تجهيز الصورة.');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',0.8);}finally{bitmap.close();}
}
export async function buildAssistantRequest(project:SeriesProject,turnId:string,encodeImage:(file:File)=>Promise<string>=imageData){
 const recent=(project.messages??[]).slice(-60),imageMessages=recent.filter(m=>m.image).slice(-4),imageIds=new Set(imageMessages.map(m=>m.id));
 const references=[...(project.visualRequests??[]).filter(r=>r.file&&r.status==='ready').map(r=>({id:r.id,kind:'unapproved-image',name:r.name,file:r.file!})),...project.characters.map(c=>({id:c.id,kind:'character',name:c.name,file:c.image})),...(project.sceneImages??[]).map(c=>({id:c.id,kind:'scene',name:c.name,file:c.image})),...(project.places??[]).flatMap(place=>place.references.map(r=>({id:r.id,kind:'place-reference',name:place.name+' — '+r.label,file:r.file})))];
 const memory={...seriesMemory(project),contextMode:project.kind==='conversation'?'general':'project',imagesIncluded:references.map(({id,kind,name})=>({id,kind,name}))};
 const messages=[];
 for(let index=0;index<references.length;index+=4){const group=references.slice(index,index+4);messages.push({role:'user',content:[{type:'input_text',text:'صور مرجعية معتمدة بهذا الترتيب: '+JSON.stringify(group.map(({id,kind,name})=>({id,kind,name})))},...await Promise.all(group.map(async r=>({type:'input_image',image_url:await encodeImage(r.file),detail:'auto'})))]});}
 for(const m of recent){const content:({type:string;text:string}|{type:string;image_url:string;detail:string})[]=[{type:'input_text',text:m.text||(m.image?(project.kind==='conversation'?'ناقش هذه الصورة بشكل طبيعي. لا تطلب اسمًا أو دورًا أو اعتماد شخصية.':'ناقش هذه الصورة واقترح الاسم والدور؛ لا تعتمدها حتى أوافق.'):'')}];if(m.image&&imageIds.has(m.id))content.push({type:'input_image',image_url:await encodeImage(m.image),detail:'auto'});messages.push({role:m.role,content});}
 return {projectId:project.id,turnId,memory,messages};
}
export async function requestSeriesAssistant(project:SeriesProject,turnId:string){
 const payload=await buildAssistantRequest(project,turnId);
 if(!import.meta.env.DEV)return await studioChat(payload) as AssistantAnswer;
 const response=await fetch('/api/series-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
 let answer;try{answer=await response.json();}catch{throw new Error('خدمة الدردشة المحلية غير متاحة. أعد فتح المعاينة.');}
 if(!response.ok||answer.error)throw new Error(answer.error??'تعذر الاتصال بالمساعد.');
 return answer as AssistantAnswer;
}
export function applyAssistantAnswer(project:SeriesProject,turnId:string,answer:AssistantAnswer):SeriesProject{
 if(project.messages?.some(m=>m.replyTo===turnId))return project;
 if(project.kind==='conversation')answer={...answer,ticket:null,imageDetails:null,conflict:null};
 let messages=project.messages??[];
 let visualRequests=project.visualRequests;
 if(answer.imageDetails){const image=[...messages].reverse().find(m=>m.image),generated=[...(visualRequests??[])].reverse().find(r=>r.file&&r.status==='ready'&&r.count===1);if(generated&&(!image||image.createdAt<(generated.createdAt??0)))visualRequests=visualRequests?.map(r=>r.id===generated.id?{...r,...answer.imageDetails!}:r);else if(image&&!image.imageApproved)messages=messages.map(m=>m.id===image.id?{...m,imageDetails:answer.imageDetails!}:m);}
 const previous=project.ticket;
 const sceneHistory=[...(project.sceneHistory??[])];
 const ticket=answer.ticket&&!answer.conflict?{story:answer.ticket.story,activeEpisodeId:previous?.activeEpisodeId,episodes:answer.ticket.episodes.map((episode,index)=>{const existing=previous?.episodes[index];if(existing?.completed)return existing;const episodeId=existing?.id??crypto.randomUUID();const scenes=(episode.scenes??[]).map(scene=>snapshotScene(project,episodeId,scene));if(scenes.length&&scenes.reduce((total,scene)=>total+scene.durationSeconds,0)!==episode.durationSeconds)throw new Error('مدد المشاهد لا تطابق مدة الحلقة. اطلب تصحيح الخطة.');sceneHistory.push(...scenes);return {id:episodeId,summary:episode.summary,durationSeconds:episode.durationSeconds,completed:false,sceneIds:scenes.length?scenes.map(s=>s.id):existing?.sceneIds};})}:previous;
 // Retain completed episodes even when the model returns an incomplete list.
 if(ticket&&previous)for(const e of previous.episodes)if(e.completed&&!ticket.episodes.some(n=>n.id===e.id))ticket.episodes.push(e);
 const context=answer.imageRequest&&!answer.conflict?addVisualProposal({...project,visualRequests},answer.imageRequest,'reply-'+turnId):{...project,visualRequests};
 const videoRequests=answer.videoRequest&&!answer.conflict?[...(project.videoRequests??[]),{...answer.videoRequest,id:crypto.randomUUID(),messageId:'reply-'+turnId,references:[...project.characters.map(c=>c.image),...(project.sceneImages??[]).slice(-1).map(s=>s.image),...messages.slice(-1).flatMap(m=>m.image?[m.image]:[])].slice(0,8),status:'draft' as const}]:project.videoRequests;
 return {...context,videoRequests,aiMemory:answer.memorySummary,ticket,sceneHistory,messages:[...messages,{id:'reply-'+turnId,replyTo:turnId,role:'assistant',text:answer.reply,model:answer.model,createdAt:Date.now()}]};
}
