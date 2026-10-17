import type {LibraryVideo} from './schedule-model';
import {baghdadInput} from './schedule-model';
export interface ScheduleChannel {id:string;service:string;name:string}
export interface DayDraft {id:string;file?:File;assetKey?:string;title:string;description:string;time:string;channelIds:string[];original?:LibraryVideo;locked?:boolean}
export function futureDayTime(day:string,time:string,now=Date.now()){
 const at=Date.parse(day+'T'+time+':00+03:00');
 return Number.isFinite(at)&&baghdadInput(at)===day+'T'+time&&at>now;
}
export function nextDayTime(day:string,occupied:string[],now=Date.now()){
 const today=baghdadInput(now).slice(0,10);
 if(day<today)throw Error('هذا اليوم انتهى. اختَر يوماً قادماً.');
 const start=day===today?Math.ceil((now+3*3600000+5*60000)/300000)*300000:Date.parse(day+'T09:00:00Z');
 for(let i=0;i<288;i++){const at=new Date(start+i*5*60000).toISOString();if(at.slice(0,10)!==day)break;const time=at.slice(11,16);if(!occupied.includes(time))return time;}
 throw Error('لا يوجد وقت متبقٍ لهذا اليوم. اختَر يوماً قادماً.');
}
export function assertVideoChannels(ids:string[],channels:ScheduleChannel[]){if(!ids.length)throw Error('اختَر منصة نشر واحدة على الأقل لكل فيديو.');if(new Set(ids).size!==ids.length||ids.some(id=>!channels.some(c=>c.id===id)))throw Error('راجع حسابات النشر المتاحة لهذا الفيديو.');}

export function dayDraft(video:LibraryVideo,channels:ScheduleChannel[],locked=false):DayDraft{return {id:video.id,assetKey:video.bunnyAssetId,title:video.metadata?.title??video.title,description:video.metadata?.description??'',time:baghdadInput(video.publishAt).slice(11,16),channelIds:video.channelIds??channels.map(c=>c.id),original:video,locked};}
export function emptyDayDraft(date:string,channels:ScheduleChannel[],occupied:string[],now=Date.now()):DayDraft{return {id:crypto.randomUUID(),title:'',description:'',time:nextDayTime(date,occupied,now),channelIds:channels.map(c=>c.id)};}
