export interface PublishMetadata {title:string;description:string;hashtags:string[];categoryId:string;madeForKids:boolean;privacy:'public'|'private'|'unlisted';isAiGenerated:boolean}
export interface PublishTarget {id:string;provider:'meta'|'buffer';platform:string;name:string}
export const youtubeCategories=['1','2','10','15','17','19','20','22','23','24','25','26','27','28','29'];
export function validatePublishMetadata(value:unknown):PublishMetadata{
 const r=value as PublishMetadata;
 if(!r||typeof r.title!=='string'||!r.title.trim()||r.title.length>100||typeof r.description!=='string'||r.description.length>4500||!Array.isArray(r.hashtags)||r.hashtags.length>10||r.hashtags.some(h=>typeof h!=='string'||!/^#[\p{L}\p{N}_]{1,50}$/u.test(h))||!youtubeCategories.includes(r.categoryId)||typeof r.madeForKids!=='boolean'||typeof r.isAiGenerated!=='boolean'||!['public','private','unlisted'].includes(r.privacy))throw Error('راجع العنوان والوصف والوسوم وإعدادات يوتيوب.');
 return {...r,title:r.title.trim()};
}
export function platformCaption(metadata:PublishMetadata,platform:string){const limit=platform==='instagram'||platform==='tiktok'?2200:5000;const suffix=metadata.hashtags.join(' ');return metadata.description.slice(0,Math.max(0,limit-suffix.length-2))+'\n\n'+suffix;}
export function publicationTargets(state:{meta:{accounts:{_id:string;platform:string;name:string;selected:boolean}[]};buffer:{channels:{id?:string;service:string;name:string;isDisconnected:boolean;isLocked:boolean}[]}}):PublishTarget[]{
 const meta=state.meta.accounts.filter(a=>a.selected).map(a=>({id:a._id,provider:'meta' as const,platform:a.platform,name:a.name}));
 const platforms=new Set(meta.map(a=>a.platform));return [...meta,...state.buffer.channels.filter(a=>a.id&&!a.isDisconnected&&!a.isLocked&&['facebook','instagram','tiktok','youtube'].includes(a.service)&&!platforms.has(a.service)).map(a=>({id:a.id!,provider:'buffer' as const,platform:a.service,name:a.name}))];
}
