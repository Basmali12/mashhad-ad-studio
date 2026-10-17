import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {BunnyStorage,type BunnyAsset,type BunnyConfig} from '../worker/bunny-storage.ts';
import {ConvexHttpClient} from 'convex/browser';
import {makeFunctionReference} from 'convex/server';

// Development staging only. This never changes a live Convex deployment.
export const privateStorageDirectory=join(homedir(),'.codex','backups','mashhad-reels-20261014');
export interface StagedAsset extends BunnyAsset {id:string;zone:string;createdAt:number;originalStorageId?:string;originalName?:string}
export async function localStorageContext(){
 const config=JSON.parse(await readFile(join(privateStorageDirectory,'bunny-storage.private.json'),'utf8')) as BunnyConfig;
 const env=await readFile(join(privateStorageDirectory,'convex-env.private.txt'),'utf8');
 const subject=env.match(/^OWNER_SUBJECT=(.*)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g,'');
 if(!subject)throw Error('هوية المالك غير مهيأة.');
 return {config,subject,storage:new BunnyStorage(config)};
}
export async function localAuthenticatedStorage(authorization:string|undefined,saas:boolean){
 const context=await localStorageContext();if(!saas)return {...context,client:undefined as ConvexHttpClient|undefined};
 if(!authorization?.startsWith('Bearer ')||authorization.length>10000)throw Error('سجّل الدخول أولًا.');
 const fixture=await readFile(join(privateStorageDirectory,'local-convex-04','.env.local'),'utf8');if(!fixture.includes('http://127.0.0.1:43240'))throw Error('المحرك المحلي غير مطابق.');
 const client=new ConvexHttpClient('http://127.0.0.1:43240');client.setAuth(authorization.slice(7));const profile=await client.query(makeFunctionReference<'query'>('publishingUsers:profile'),{}) as {subject:string};
 return {...context,subject:profile.subject,client};
}
const registryPath=join(privateStorageDirectory,'bunny-registry.private.json');
export async function stagedAssets():Promise<StagedAsset[]>{try{return JSON.parse(await readFile(registryPath,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw Error('تعذرت قراءة سجل التخزين؛ لا تكتب فوقه.',{cause:e});}}
let writes=Promise.resolve();
export async function recordStagedAsset(asset:StagedAsset){
 const operation=writes.then(async()=>{const assets=await stagedAssets();const existing=assets.find(a=>a.id===asset.id&&a.subject===asset.subject);if(existing){if(existing.path!==asset.path||existing.zone!==asset.zone||existing.size!==asset.size||existing.type!==asset.type)throw Error('تغيرت هوية النسخة المحفوظة.');return;}await mkdir(privateStorageDirectory,{recursive:true});const temp=registryPath+'.tmp';await writeFile(temp,JSON.stringify([...assets,asset],null,2),{mode:0o600});await rename(temp,registryPath);});
 writes=operation.catch(()=>{});await operation;
}
