import type {ConvexReactClient} from 'convex/react';


export const publishingSaasMode=import.meta.env.VITE_PUBLISHING_SAAS_READY==='true'||import.meta.env.DEV&&import.meta.env.VITE_PUBLISHING_SAAS_PREVIEW==='true';
let connected:{client:ConvexReactClient;token:()=>Promise<string|null>}|null=null;
export function connectPublishingCloud(client:ConvexReactClient,token:()=>Promise<string|null>){const state={client,token};connected=state;return()=>{if(connected===state)connected=null;void fetch('/api/bunny-session',{method:'POST'}).catch(()=>{});};}
export function publishingConnection(){if(!connected)throw Error('انتظر اكتمال تسجيل دخول حسابك.');return connected;}
export async function publishingHeaders():Promise<Record<string,string>>{if(!publishingSaasMode)return {};const token=await publishingConnection().token();if(!token)throw Error('انتهت جلسة الدخول؛ سجّل الدخول من جديد.');return {Authorization:'Bearer '+token};}
