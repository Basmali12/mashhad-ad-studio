import type {SeriesProject,SeriesMessage} from './redesign-data';
import type {VisualRequest} from './redesign-visual';
import {requestsImageGeneration} from './redesign-image-intent';

type ChatEntry={kind:'message';message:SeriesMessage}|{kind:'image';request:VisualRequest};
export function chatTimeline(project:SeriesProject):ChatEntry[]{
 const messages=project.messages??[],groups=new Map<number,VisualRequest[]>();
 // Older saved pictures predate message anchors; infer their original generation turn.
 const legacyAnchors=messages.flatMap((message,index)=>{
  const user=message.replyTo?messages.find(m=>m.id===message.replyTo):messages[index-1];
  return message.role==='assistant'&&user?.role==='user'&&requestsImageGeneration(user.text)?[index]:[];
 });
 for(const [ordinal,request] of (project.visualRequests??[]).entries()){
  let index=request.messageId?messages.findIndex(m=>m.id===request.messageId):-1;
  if(index<0&&request.createdAt!==undefined)index=messages.reduce((last,m,i)=>m.createdAt<=request.createdAt!?i:last,-1);
  if(index<0)index=legacyAnchors[ordinal]??legacyAnchors.at(-1)??messages.findIndex(m=>m.role==='assistant');
  const group=groups.get(index)??[];group.push(request);groups.set(index,group);
 }
 const entries:ChatEntry[]=[];
 for(const request of groups.get(-1)??[])entries.push({kind:'image',request});
 messages.forEach((message,index)=>{entries.push({kind:'message',message});for(const request of groups.get(index)??[])entries.push({kind:'image',request});});
 return entries;
}
