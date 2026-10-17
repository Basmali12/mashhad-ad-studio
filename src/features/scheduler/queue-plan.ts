import type {PublishingCollection} from '../library/collection-store';
import {nextPublishAt,taskStart,type PublishTask} from './schedule-model';
// Only draft dates change. Server jobs and confirmed history are never edited here.
export function planQueue(collection:PublishingCollection,task:PublishTask,now=Date.now()):PublishingCollection{
 if(task.mode==='manual')return collection;
 const rows=collection.libraryVideos??[],drafts=rows.filter(v=>!v.movedTo&&!v.publishedAt&&!v.publicationId&&(!v.taskId||v.taskId===task.id));
 const fixed=rows.filter(v=>!drafts.includes(v)),scheduled=[...fixed],updates=new Map<string,typeof rows[number]>();
 for(const video of [...drafts].sort((a,b)=>a.publishAt.localeCompare(b.publishAt))){const publishAt=nextPublishAt(task,scheduled,taskStart(task,now)),next={...video,taskId:task.id,publishAt};scheduled.push(next);updates.set(video.id,next);}
 return {...collection,libraryVideos:rows.map(v=>updates.get(v.id)??v)};
}
