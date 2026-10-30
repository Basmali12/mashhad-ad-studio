import {isFailure,type FilmRequest} from './filmClient';
export type SetupStage='connection'|'inspection'|'quote'|'approval'|'transfer'|'ready'|'error';
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
  terminal:['completed','failed','stopped','uncertain','needs_review'].includes(job.status||'')};
}
