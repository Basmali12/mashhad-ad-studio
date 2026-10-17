export interface BunnyUsage {status:'ok'|'partial'|'unavailable';observedAt:number;bytes:number|null;files:number|null;videoBytes:number|null;videoFiles:number|null;requests:number;reason?:string}
export interface ServerUsage {status:'ok'|'unavailable';observedAt:number;diskTotalBytes:number|null;diskUsedBytes:number|null;diskAvailableBytes:number|null;memoryTotalBytes:number|null;memoryAvailableBytes:number|null;serviceRssBytes:number|null;temporaryUploadBytes:number|null;temporaryUploadFiles:number|null;reason?:string}
export interface Infrastructure {bunny:BunnyUsage;server:ServerUsage;cacheSeconds:number}
export function unavailableInfrastructure():Infrastructure{
 const observedAt=Date.now();return {cacheSeconds:60,bunny:{status:'unavailable',observedAt,bytes:null,files:null,videoBytes:null,videoFiles:null,requests:0,reason:'تعذرت قراءة Bunny؛ الرقم غير متاح.'},server:{status:'unavailable',observedAt,diskTotalBytes:null,diskUsedBytes:null,diskAvailableBytes:null,memoryTotalBytes:null,memoryAvailableBytes:null,serviceRssBytes:null,temporaryUploadBytes:null,temporaryUploadFiles:null,reason:'تعذرت قراءة السيرفر؛ الرقم غير متاح.'}};
}
export function parseInfrastructure(input:unknown):Infrastructure{
 if(!input||typeof input!=='object')throw Error('Invalid infrastructure');
 const value=input as Infrastructure,empty=unavailableInfrastructure();
 if(!value.bunny||!value.server||!['ok','partial','unavailable'].includes(value.bunny.status)||!['ok','unavailable'].includes(value.server.status))throw Error('Invalid status');
 const number=(n:unknown):number=>{if(typeof n!=='number'||!Number.isSafeInteger(n)||n<0)throw Error('Invalid measurement');return n;};
 const nullable=(n:unknown)=>n===null?null:number(n);
 const bunny={...empty.bunny,status:value.bunny.status,observedAt:number(value.bunny.observedAt),requests:number(value.bunny.requests)};
 if(bunny.status!=='unavailable'){bunny.bytes=number(value.bunny.bytes);bunny.files=number(value.bunny.files);bunny.videoBytes=number(value.bunny.videoBytes);bunny.videoFiles=number(value.bunny.videoFiles);bunny.reason=bunny.status==='partial'?'قراءة جزئية؛ وصل الفحص إلى حد الأمان.':undefined;}
 const server={...empty.server,status:value.server.status,observedAt:number(value.server.observedAt)};
 if(server.status==='ok'){server.reason=undefined;for(const key of ['diskTotalBytes','diskUsedBytes','diskAvailableBytes','memoryTotalBytes','memoryAvailableBytes','serviceRssBytes','temporaryUploadBytes','temporaryUploadFiles'] as const)server[key]=nullable(value.server[key]);}
 return {bunny,server,cacheSeconds:60};
}
