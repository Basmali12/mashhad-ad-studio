import {isFailure,type FilmRequest} from './filmClient';
export type SetupStage='connection'|'inspection'|'quote'|'approval'|'transfer'|'ready'|'error';
export function accountInputError(input:Record<string,unknown>){
 if(typeof input.name!=='string'||!input.name.trim())return 'اكتب اسم الحساب.';
 if(typeof input.tokenId!=='string'||!/^ak-[A-Za-z0-9_-]{8,200}$/.test(input.tokenId))return 'حقل Token ID يحتاج القيمة التي تبدأ بـ ak- فقط، وليس أمر modal token set.';
 if(typeof input.tokenSecret!=='string'||!/^as-[A-Za-z0-9_-]{8,200}$/.test(input.tokenSecret))return 'حقل Token Secret يحتاج القيمة التي تبدأ بـ as- فقط. لا تضع Token ID هنا.';
 return null;
}
export async function setupCall(request:FilmRequest,operation:Parameters<FilmRequest>[0],input:Record<string,unknown>={}){
 const value=await request(operation,input,crypto.randomUUID());
 if(isFailure(value))throw Error(value.message);
 return value;
}
// Saving credentials never grants permission to dispatch paid work.
export async function linkAndPlan(request:FilmRequest,input:Record<string,unknown>,stage:(value:SetupStage)=>void,linked:(id:string)=>void){
 stage('connection');const account=await setupCall(request,'admin.account.link',input);linked(account.id);
 stage('inspection');await setupCall(request,'admin.account.inspect',{accountId:account.id});
 stage('quote');const quote=await setupCall(request,'admin.prepare.quote',{accountId:account.id});
 stage('approval');return quote;
}
export function transferView(job:{status?:string;cloudStopped?:boolean;result?:{ready?:boolean};events?:Array<Record<string,unknown>>}){
 const events=job.events||[],latest=events.filter(e=>typeof e.phase==='string').at(-1);
 const measurement=events.filter(e=>e.phase===latest?.phase&&typeof e.transferred==='number'&&typeof e.required==='number').at(-1);
 const completed=events.filter(e=>e.kind==='file_verified').map(e=>String(e.file));
 return {phase:String(latest?.phase||'connection'),measurement,verified:new Set(completed).size,
  ready:job.status==='completed'&&job.cloudStopped===true&&job.result?.ready===true,
  terminal:job.cloudStopped===true&&['completed','failed','stopped','needs_review','uncertain'].includes(job.status||'')};
}
