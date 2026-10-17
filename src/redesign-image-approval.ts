import type {SeriesProject} from './redesign-data';
export function approveLatestImage(project:SeriesProject):SeriesProject{
 const pending=[...(project.messages??[])].reverse().find(message=>message.image);
 if(!pending?.image||pending.imageApproved)return project;
 const details=pending.imageDetails??{kind:'scene' as const,name:`صورة ${(project.sceneImages?.length??0)+1}`,description:''};
 const asset={id:pending.id,name:details.name,description:details.description,image:pending.image,updatedAt:Date.now()};
 return {...project,messages:project.messages?.map(message=>message.id===pending.id?{...message,imageApproved:true}:message),...(details.kind==='character'?{characters:[...project.characters,asset]}:{sceneImages:[...(project.sceneImages??[]),{...asset,description:details.description}]})};
}

