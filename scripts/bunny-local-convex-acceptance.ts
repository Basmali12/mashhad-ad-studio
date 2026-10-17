import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {ConvexHttpClient} from 'convex/browser';
import {makeFunctionReference} from 'convex/server';
import {localStorageContext,stagedAssets,privateStorageDirectory} from './bunny-local-store.ts';
const run=promisify(execFile),fixture=join(privateStorageDirectory,'local-convex-04'),cli=join(process.cwd(),'node_modules','convex','bin','main.js');
const deployment=await readFile(join(fixture,'.env.local'),'utf8');
if(!/^CONVEX_DEPLOYMENT=anonymous:/m.test(deployment)||!deployment.includes('http://127.0.0.1:43240'))throw Error('يمنع الاختبار خارج Convex المحلي المعزول.');
const {subject,config}=await localStorageContext();
const localConfig=JSON.parse(await readFile(join(fixture,'.convex','local','default','config.json'),'utf8')) as {adminKey:string;ports:{cloud:number}};
if(localConfig.ports.cloud!==43240)throw Error('منفذ Convex غير مطابق.');const envFile=join(privateStorageDirectory,'local-convex-direct.private.env');await writeFile(envFile,`CONVEX_SELF_HOSTED_URL=http://127.0.0.1:43240\nCONVEX_SELF_HOSTED_ADMIN_KEY=${localConfig.adminKey}\n`,{mode:0o600});
async function invoke(args:string[]){const result=await run(process.execPath,[cli,...args,'--env-file',envFile],{cwd:fixture,env:{...process.env,CONVEX_AGENT_MODE:'anonymous',CONVEX_DEPLOYMENT:undefined,CONVEX_DEPLOY_KEY:undefined},maxBuffer:500000});return result.stdout.trim();}
await invoke(['env','set','OWNER_SUBJECT',subject]);await invoke(['env','set','BUNNY_STORAGE_ZONE',config.zone]);
const issuer=(await invoke(['env','get','CLERK_JWT_ISSUER_DOMAIN'])).replace(/^['"]|['"]$/g,'');
const client=new ConvexHttpClient('http://127.0.0.1:43240');
// SDK admin auth is restricted here to the disposable loopback deployment only.
const adminClient=client as ConvexHttpClient & {setAdminAuth(key:string,identity?:{subject:string;issuer:string}):void};adminClient.setAdminAuth(localConfig.adminKey);
const assets=(await stagedAssets()).filter(a=>a.subject===subject&&a.zone===config.zone);const ids:string[]=[];
for(const a of assets){const input={subject,key:a.sha256,objectPath:a.path,sha256:a.sha256,size:a.size,type:a.type};const fn=makeFunctionReference<'mutation'>('mediaAssets:recordVerified');const id=await client.mutation(fn,input);const again=await client.mutation(fn,input);if(id!==again)throw Error('تكرر سجل الملف.');ids.push(id);}
adminClient.setAdminAuth(localConfig.adminKey,{subject,issuer});const rows=await client.query(makeFunctionReference<'query'>('mediaAssets:state'),{}) as {id:string;key:string}[];
if(rows.length!==assets.length||new Set(rows.map(a=>a.id)).size!==assets.length)throw Error('عدد الملفات المحفوظة غير مطابق.');
adminClient.setAdminAuth(localConfig.adminKey,{subject:'another-account',issuer});let denied=false;try{await client.query(makeFunctionReference<'query'>('mediaAssets:state'),{});}catch{denied=true;}if(!denied)throw Error('تسربت الملفات إلى حساب آخر.');
const snapshot=join(privateStorageDirectory,'local-convex-04-data-'+Date.now()+'.zip');await invoke(['export','--path',snapshot]);
// Only the disposable local fixture is restored. The live deployment is never selected.
await invoke(['import','--replace','--yes',snapshot]);adminClient.setAdminAuth(localConfig.adminKey,{subject,issuer});const restored=await client.query(makeFunctionReference<'query'>('mediaAssets:state'),{}) as {id:string;key:string}[];
if(JSON.stringify(rows.map(r=>r.id).sort())!==JSON.stringify(restored.map(r=>r.id).sort()))throw Error('تغيرت المعرفات بعد الاستعادة المحلية.');
await writeFile(join(privateStorageDirectory,'bunny-convex-acceptance.private.json'),JSON.stringify({at:new Date().toISOString(),deployment:'local anonymous port 43240',count:rows.length,idempotent:true,otherAccountDenied:true,snapshotRestored:true,productionChanged:false,ids},null,2),{mode:0o600});
console.log(JSON.stringify({localConvexRecords:rows.length,idempotent:true,otherAccountDenied:true,snapshotRestored:true,productionChanged:false}));
