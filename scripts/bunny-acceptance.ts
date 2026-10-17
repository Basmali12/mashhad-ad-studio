import {readFile,writeFile} from 'node:fs/promises';
import {openAsBlob} from 'node:fs';
import {createHash} from 'node:crypto';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {BunnyStorage} from '../worker/bunny-storage.ts';
import {localStorageContext,stagedAssets,recordStagedAsset,privateStorageDirectory} from './bunny-local-store.ts';

// Explicit manual run only: uploads current-owner files; never deletes originals or publishes.
const {config,subject}=await localStorageContext();
const storage=new BunnyStorage(config,async(url,init)=>{try{return await fetch(url,init);}catch(e){const error=e as Error & {cause?:{code?:string;name?:string}};console.error(JSON.stringify({networkError:error.name,causeCode:error.cause?.code,causeName:error.cause?.name}));throw e;}});
const transfer=join(homedir(),'.codex','transfers','mashhad-bunny-20261013');
const manifest=JSON.parse(await readFile(join(transfer,'source-manifest.json'),'utf8')) as {scope:string;originalsRetained:boolean;files:{id:string;name:string;sha256:string;size:number;type:string;localVerified:boolean}[]};
if(manifest.scope!=='current-owner-only'||!manifest.originalsRetained)throw Error('نطاق النقل غير مصرح.');
const evidence:{originalStorageId:string;sha256:string;size:number;type:string;verified:boolean;reused:boolean}[]=[];
for(const file of manifest.files){
 if(!file.localVerified||file.name.includes('/')||file.name.includes('\\'))throw Error('ملف المصدر غير موثوق.');
 const source=join(transfer,'media',file.name),blob=await openAsBlob(source,{type:file.type}),hash=createHash('sha256'),reader=blob.stream().getReader();
 for(;;){const chunk=await reader.read();if(chunk.done)break;hash.update(chunk.value);}reader.releaseLock();
 if(blob.size!==file.size||hash.digest('hex')!==file.sha256)throw Error('المصدر المحلي لا يطابق النسخة الاحتياطية.');
 const existing=(await stagedAssets()).find(a=>a.id===file.sha256&&a.subject===subject&&a.zone===config.zone);
 if(existing)await storage.verify(subject,existing.path,file.sha256,file.size);
 else{const asset=await storage.upload(subject,blob,file.sha256);await recordStagedAsset({...asset,id:asset.sha256,zone:config.zone,createdAt:Date.now(),originalStorageId:file.id,originalName:file.name});}
 evidence.push({originalStorageId:file.id,sha256:file.sha256,size:file.size,type:file.type,verified:true,reused:!!existing});
 console.log(JSON.stringify({verified:evidence.length,total:manifest.files.length,size:file.size,type:file.type}));
}
const report={at:new Date().toISOString(),zone:config.zone,scope:manifest.scope,originalsRetained:true,productionChanged:false,convexMetadata:'staged privately, awaiting approved deployment',count:evidence.length,totalBytes:evidence.reduce((n,a)=>n+a.size,0),files:evidence};
await writeFile(join(privateStorageDirectory,'bunny-real-acceptance.private.json'),JSON.stringify(report,null,2),{mode:0o600});
console.log(JSON.stringify({completed:evidence.length,totalBytes:report.totalBytes,originalsRetained:true}));
