import type {PublishingCollection} from '../library/collection-store';
export type CalendarStatus='published'|'pending'|'working'|'partial'|'review'|'cancelled'|'test';
export interface CalendarJob { _id:string;createdAt:number;collectionId:string;videoId:string;dueAt:number;dryRun:boolean;cancelled:boolean;deliveries:{platform:string;phase:string}[] }
export interface CalendarVideo {key:string;collectionId:string;videoId:string;title:string;at:number;status:CalendarStatus;source:'local'|'server';platforms:string[]}
export const calendarLabels:Record<CalendarStatus,string>={published:'منشور',pending:'بانتظار النشر',working:'جارٍ النشر',partial:'منشور جزئياً',review:'يحتاج مراجعة',cancelled:'ملغي',test:'اختبار دون نشر'};
export function baghdadDay(at:number|string){const ms=typeof at==='number'?at:Date.parse(at);return Number.isFinite(ms)?new Date(ms+3*3600000).toISOString().slice(0,10):'';}
export function shiftCalendarDay(day:string,count:number){return new Date(Date.parse(day+'T12:00:00Z')+count*86400000).toISOString().slice(0,10);}
export function calendarStart(collections:PublishingCollection[],firstDueAt?:number|null,now=Date.now()){
 const dates=collections.flatMap(c=>(c.libraryVideos??[]).filter(v=>!v.movedTo).map(v=>baghdadDay(v.publishAt||v.publishedAt||''))).filter(Boolean);
 if(firstDueAt!=null&&Number.isFinite(firstDueAt))dates.push(baghdadDay(firstDueAt));
 if(dates.length)return dates.sort()[0];
 const configured=collections.flatMap(c=>(c.publishTasks??[]).map(t=>t.startDate??'')).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d));
 return configured.sort()[0]??baghdadDay(now);
}
function jobStatus(job:CalendarJob):CalendarStatus{
 if(job.dryRun)return 'test';
 if(job.cancelled)return 'cancelled';
 const phases=job.deliveries.map(d=>d.phase);
 if(phases.length&&phases.every(p=>p==='published'))return 'published';
 if(phases.some(p=>['uncertain','failed','paused'].includes(p)))return 'review';
 if(phases.some(p=>p==='published'))return 'partial';
 if(phases.some(p=>['sending','accepted','leased'].includes(p)))return 'working';
 if(phases.length&&phases.every(p=>p==='cancelled'))return 'cancelled';
 return 'pending';
}
export function calendarVideos(collections:PublishingCollection[],jobs:CalendarJob[]):CalendarVideo[]{
 const videos=new Map<string,CalendarVideo>();
 for(const c of collections)for(const v of c.libraryVideos??[]){if(v.movedTo)continue;const at=Date.parse(v.publishAt||v.publishedAt||'');if(!Number.isFinite(at))continue;const key=JSON.stringify([c.id,v.id]);videos.set(key,{key,collectionId:c.id,videoId:v.id,title:v.title,at,status:v.publishedAt?'published':v.publishingError?'review':'pending',source:'local',platforms:[]});}
 // One dot per video, not per destination. Latest matching job replaces the local draft.
 const latest=new Map<string,CalendarJob>();for(const job of jobs){const key=JSON.stringify([job.collectionId,job.videoId]);const old=latest.get(key);if(!old||job.createdAt>old.createdAt)latest.set(key,job);}
 for(const [key,job]of latest){const collection=collections.find(c=>c.id===job.collectionId),video=collection?.libraryVideos?.find(v=>v.id===job.videoId);if(video?.movedTo)continue;videos.set(key,{key,collectionId:job.collectionId,videoId:job.videoId,title:video?.title??job.videoId,at:job.dueAt,status:jobStatus(job),source:'server',platforms:[...new Set(job.deliveries.map(d=>d.platform))]});}
 return [...videos.values()].sort((a,b)=>a.at-b.at||a.key.localeCompare(b.key));
}
export function calendarDays(start:string,items:CalendarVideo[]){return Array.from({length:30},(_,i)=>{const day=shiftCalendarDay(start,i);return {day,videos:items.filter(v=>baghdadDay(v.at)===day)};});}
