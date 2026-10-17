import type {PublishingCollection} from '../library/collection-store';
import type {PublishMetadata,PublishTarget} from '../../../shared/library-publishing';
export interface PublishSchedule {times:string[];timezone:'Asia/Baghdad';mode?:'automatic'|'manual';intervalDays?:1|2|3;startDate?:string}
export interface PublishTask extends PublishSchedule {id:string;name:string;createdAt:number;startDate?:string;automaticPublishing?:boolean;targets?:PublishTarget[];audience?:{madeForKids:boolean;privacy:PublishMetadata['privacy'];isAiGenerated:boolean}}
export interface LibraryVideo {id:string;title:string;file?:File;url?:string;bunnyAssetId?:string;legacySourceJobId?:string;videoRequestId?:string;sourceProjectId?:string;taskId?:string;publishAt:string;publishedAt?:string;createdAt:number;storageId?:string;publicationId?:string;metadata?:PublishMetadata;metadataReviewed?:boolean;channelIds?:string[];movedTo?:string;publishingError?:string}
export const defaultSchedule:PublishSchedule={times:['09:00'],timezone:'Asia/Baghdad'};
const timePattern=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
export function validateSchedule(schedule:PublishSchedule){if(schedule.timezone!=='Asia/Baghdad'||schedule.times.length<1||schedule.times.length>10||schedule.times.some(t=>!timePattern.test(t))||new Set(schedule.times).size!==schedule.times.length)throw new Error('اختار من 1 إلى 10 أوقات مختلفة وصحيحة للنشر.');return [...schedule.times].sort();}
export function baghdadInput(at:number|string){return new Date(new Date(at).getTime()+3*3600000).toISOString().slice(0,16);}
export function manualPublishAt(value:string,items:LibraryVideo[],now=Date.now()){
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))throw new Error('اختار تاريخ ووقت النشر.');
 const at=new Date(value+':00+03:00');if(!Number.isFinite(at.getTime())||baghdadInput(at.toISOString())!==value||at.getTime()<=now)throw new Error('موعد النشر لازم يكون بالمستقبل.');
 if(items.some(v=>new Date(v.publishAt).getTime()===at.getTime()))throw new Error('هذا الموعد محجوز لفيديو آخر. اختار وقتًا مختلفًا.');return at.toISOString();
}
export function nextPublishAt(schedule:PublishSchedule,items:LibraryVideo[],now=Date.now()){
 const times=validateSchedule(schedule);
 if(schedule.intervalDays!==undefined&&![1,2,3].includes(schedule.intervalDays))throw Error('اختار النشر كل يوم أو يومين أو ثلاثة.');
 const last=Math.max(now,...items.map(v=>new Date(v.publishAt).getTime()).filter(Number.isFinite));
 const day=baghdadInput(last).slice(0,10);
 const anchor=schedule.startDate??(items.filter(v=>v.publishAt).map(v=>baghdadInput(v.publishAt).slice(0,10)).sort()[0]??baghdadInput(now+1).slice(0,10));
 const anchorAt=Date.parse(anchor+'T00:00:00Z');
 if(!Number.isFinite(anchorAt)||new Date(anchorAt).toISOString().slice(0,10)!==anchor)throw Error('تاريخ البداية غير صحيح.');
 for(let d=0;d<370;d++){
  const date=new Date(day+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+d);
  const distance=Math.round((date.getTime()-anchorAt)/86400000);
  if(distance<0||distance%(schedule.intervalDays??1)!==0)continue;
  for(const time of times){const candidate=new Date(date.toISOString().slice(0,10)+'T'+time+':00+03:00');if(candidate.getTime()>last)return candidate.toISOString();}
 }
 throw new Error('تعذر تحديد الموعد القادم.');
}
export function taskStart(task:PublishTask|undefined,now=Date.now()){if(!task?.startDate)return now;const at=Date.parse(task.startDate+'T00:00:00+03:00');if(!Number.isFinite(at))throw Error('تاريخ بداية المهمة غير صحيح.');return Math.max(now,at-1);}
export function tomorrowBaghdad(now=Date.now()){return baghdadInput(now+86400000).slice(0,10);}
export function reorderLibraryVideo<T extends Omit<PublishingCollection,'kind'> & {kind?:string}>(project:T,id:string,targetId:string,now=Date.now()):T{
 const all=project.libraryVideos??[],video=all.find(v=>v.id===id),target=all.find(v=>v.id===targetId);
 if(video?.publicationId||target?.publicationId)throw Error('ألغِ الموعد على السيرفر قبل تغيير الترتيب.');if(!video||!target||video.publishedAt||target.publishedAt||video.taskId!==target.taskId)throw Error('غيّر الترتيب بين فيديوات غير منشورة داخل نفس المهمة.');
 const pending=all.filter(v=>!v.publishedAt&&v.taskId===video.taskId).sort((a,b)=>a.publishAt.localeCompare(b.publishAt));
 if(pending.some(v=>v.publicationId))throw Error('ألغِ المواعيد المرتبطة على السيرفر قبل إعادة الترتيب.');
 const slots=pending.map(v=>v.publishAt);
 const index=pending.findIndex(v=>v.id===targetId);pending.splice(pending.findIndex(v=>v.id===id),1);pending.splice(index,0,video);
 const task=project.publishTasks?.find(t=>t.id===video.taskId),schedule=task??project.publishSchedule??defaultSchedule;
 if(schedule.mode==='manual'){const lookup=new Map(pending.map((v,i)=>[v.id,{...v,publishAt:slots[i]}]));return {...project,libraryVideos:all.map(v=>lookup.get(v.id)??v)};}
 const scheduled=all.filter(v=>v.publishedAt&&v.taskId===video.taskId);
 const occupied=all.filter(v=>v.taskId!==video.taskId).map(v=>v.publishAt);
 for(const item of pending){let at=nextPublishAt(schedule,scheduled,taskStart(task,now));while(occupied.includes(at))at=nextPublishAt(schedule,[...scheduled,{...item,publishAt:at}],taskStart(task,now));scheduled.push({...item,publishAt:at});}
 const lookup=new Map(scheduled.map(v=>[v.id,v]));return {...project,libraryVideos:all.map(v=>lookup.get(v.id)??v)};
}
export function addLibraryVideo<T extends Omit<PublishingCollection,'kind'> & {kind?:string}>(project:T,video:Omit<LibraryVideo,'publishAt'>,manual?:string,now=Date.now()):T & Pick<PublishingCollection,'libraryVideos'>{
 const rows=project.libraryVideos??[];
 if(rows.some(v=>v.id===video.id||video.videoRequestId&&v.videoRequestId===video.videoRequestId))throw new Error('هذا الفيديو موجود بالحافظة بالفعل.');
 if(!video.file&&!video.storageId&&!video.url)throw new Error('الفيديو مو جاهز بعد.');
 const task=project.publishTasks?.find(t=>t.id===video.taskId);
 if(video.taskId&&!task)throw new Error('مهمة النشر غير موجودة.');
 const start=taskStart(task,now);
 if((task??project.publishSchedule)?.mode==='manual'&&!manual)throw Error('اختار موعد هذا الفيديو في الجدولة اليدوية.');
 let publishAt=manual?manualPublishAt(manual,rows,now):nextPublishAt(task??project.publishSchedule??defaultSchedule,task?rows.filter(v=>v.taskId===task.id):rows,start);
 while(rows.some(v=>v.publishAt===publishAt))publishAt=nextPublishAt(task??project.publishSchedule??defaultSchedule,[...rows.filter(v=>!task||v.taskId===task.id),{...video,publishAt}],start);
 return {...project,libraryVideos:[...rows,{...video,publishAt}]};
}
