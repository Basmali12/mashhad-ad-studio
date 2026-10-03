import { readFile,writeFile,unlink,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Doc } from '../convex/_generated/dataModel';
import { root,read,persist,connection,rpc,exclusive } from './runtime';
import { browser,inspect,workspace,screenshot } from './browser';
import { configure,attachments,media,waitAssets,download,type Plan,type Asset } from './flow';
import { probe } from './media';
interface Journal{requestId:string;fence:string;phase:'prepared'|'intent'|'submitted'|'unknown'|'downloaded'|'uploaded';plan?:Plan;baseline:string[];assetIds:string[];files:{assetId:string;path:string}[]}
const [command,requestId]=process.argv.slice(2);
let stopping=false;process.on('SIGINT',()=>{stopping=true});process.on('SIGTERM',()=>{stopping=true});
const stopRequested=async()=>stopping||!!await read<boolean>('stop.json');
async function upload(j:Journal,row:Doc<'requests'>){const config=await connection();const identity={requestId:j.requestId,workerId:config.workerId,fence:j.fence};
 for(const file of j.files){const metadata=await probe(file.path);if(row.form.aspect==='9:16'&&metadata.width>=metadata.height)throw new Error('VIDEO_INVALID: wrong aspect ratio');
 const key=`video:${metadata.hash}`;const ticket=await rpc<{storageId:string|null;url:string|null}>('upload',{...identity,key,name:`${file.assetId}.mp4`,size:metadata.size});let storageId=ticket.storageId;
 if(!storageId){const response=await fetch(ticket.url!,{method:'POST',headers:{'Content-Type':'video/mp4'},body:await readFile(file.path),signal:AbortSignal.timeout(120000)});if(!response.ok)throw new Error('UPLOAD_FAILED: local file retained. Use worker:reupload; do not generate again.');storageId=(await response.json() as {storageId:string}).storageId;}
 await rpc('finish',{...identity,key,storageId,assetId:file.assetId,duration:metadata.duration,width:metadata.width,height:metadata.height});console.log(`Uploaded verified asset ${file.assetId}: ${metadata.duration}s ${metadata.width}x${metadata.height}`);
 }
 j.phase='uploaded';await persist(`${j.requestId}.json`,j);
}
async function main(){
 if(command==='status'){console.log(await read('status.json')??'Worker not running');return;}
 if(command==='stop'){await persist('stop.json',true);console.log('Stop requested. Submission is never retried automatically.');return;}
 if(command==='login'||command==='inspect'){const b=await browser();try{const data=await inspect(b.page);await persist('inspection.json',data);console.log('Verified generation workspace. No credits spent.');console.log(data);}catch{console.log('يحتاج تسجيل دخول: أكمل الدخول وافتح مشروع Flow في Chrome المرئي ثم شغّل worker:inspect.');}return;}
 if(!['review','run','resume','reupload'].includes(command)||!requestId||!/^[a-z0-9]+$/.test(requestId))throw new Error('Usage: worker:review|run|resume|reupload -- REQUEST_ID');
 const unlock=await exclusive();await unlink(resolve(root,'stop.json')).catch(()=>undefined);
 const config=await connection();const j=await read<Journal>(`${requestId}.json`)??{requestId,fence:randomUUID(),phase:'prepared',baseline:[],assetIds:[],files:[]};
 let heartbeat:NodeJS.Timeout|undefined;let b:Awaited<ReturnType<typeof browser>>|undefined;let row:Doc<'requests'>|null=null;
 try{
 row=await rpc<Doc<'requests'>>('claim',{requestId,workerId:config.workerId,fence:j.fence,allowCompleted:command==='reupload'});j.phase=row.runner?.phase??j.phase;await persist(`${requestId}.json`,j);
 const identity={requestId,workerId:config.workerId,fence:j.fence};heartbeat=setInterval(()=>{rpc('heartbeat',identity).catch(()=>{stopping=true})},15000);
 await persist('status.json',{pid:process.pid,requestId,command,at:new Date().toISOString(),state:'running'});
 if(command==='reupload'){if(!j.files.length)throw new Error('No downloaded file. Resume exact job first.');await upload(j,row);return;}
 b=await browser();await workspace(b.page);
 if(j.phase==='prepared'){
 if(command==='resume')throw new Error('No submission exists. Use review first.');
 const seconds=Number(process.argv.find(a=>a.startsWith('--seconds='))?.split('=')[1]??6);const resolution=process.argv.includes('--720p')?'720p':'360p';
 const plan=await configure(b.page,row.form.model,row.form.aspect,seconds,resolution,1);
 const requiredClips=Math.max(row.clipCount,Math.ceil(row.form.duration/seconds));
 await rpc('progress',{...identity,status:'بانتظار التشغيل',phase:'prepared',projectPath:plan.projectPath,estimatedPoints:plan.cost,clipSeconds:seconds,requiredClips});
 if(command==='review'){j.plan=plan;await persist(`${requestId}.json`,j);console.log(JSON.stringify({...plan,requiredClips,requestId,warning:'Source clips only. No montage. Cost is UI estimate, not confirmed consumption.'},null,2));return;}
 if(!j.plan||JSON.stringify(j.plan)!==JSON.stringify(plan))throw new Error('Review changed. Run worker:review again before spending.');
 if(await read('one-trial-budget.json'))throw new Error('The single authorized trial was already attempted. No second generation is allowed.');
 if(row.form.aspect!=='9:16'||row.clipCount!==1||requiredClips!==1)throw new Error('The authorized trial is one vertical source clip only. Multi-clip plans remain pending.');
 // Exact project must be empty; never interfere with other browser work or infer gallery order.
 if(await b.page.locator('video, flow-video-tile, flow-image-tile').count()!==0)throw new Error('Use an empty dedicated test project. Existing media makes correlation unsafe.');
 const paths:string[]=[];
 for(const storageId of row.referenceIds){const response=await fetch(`${config.site}/runner`,{method:'POST',headers:{Authorization:`Bearer ${config.token}`,'Content-Type':'application/json'},body:JSON.stringify({op:'file',args:{requestId,storageId}})});if(!response.ok)throw new Error('Reference download refused');const extension:Record<string,string>={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'};const suffix=extension[response.headers.get('Content-Type')??''];if(!suffix)throw new Error('Unsupported reference type');const path=resolve(root,`${storageId}.${suffix}`);await writeFile(path,new Uint8Array(await response.arrayBuffer()));paths.push(path);}
 await attachments(b.page,paths);
 const prompt=await workspace(b.page);await prompt.fill(`${row.form.prompt}\n${row.form.instructions}\nاللهجة عند وجود كلام: ${row.form.dialect}\nلا تضف شعارًا أو نصوصًا أو مونتاجًا في هذه المرحلة.`);
 j.baseline=(await media(b.page)).map(a=>a.id);j.phase='intent';await persist(`${requestId}.json`,j);
 if(stopping)throw new Error('STOPPED: lease or connection lost before submission.');
 // Consume the local one-trial budget BEFORE the only click. Failures never refund it automatically.
 await persist('one-trial-budget.json',{requestId,at:new Date().toISOString(),plan});await rpc('progress',{...identity,phase:'intent',status:'قيد التوليد'});
 await b.page.getByRole('button',{name:'بدء الإنشاء',exact:true}).click({timeout:10000});
 j.phase='submitted';await persist(`${requestId}.json`,j);await rpc('progress',{...identity,phase:'submitted',status:'قيد التوليد',taskId:`flow-project:${plan.projectPath.split('/').at(-1)}`});
 }else if(command==='run'||command==='review')throw new Error('Submission already attempted. Use resume or reupload only.');
 if(j.plan&&!new URL(b.page.url()).pathname.startsWith(j.plan.projectPath+'/')&&new URL(b.page.url()).pathname!==j.plan.projectPath)throw new Error('Wrong Flow project. Open the saved exact project before resume.');
 if(j.files.length){await upload(j,row);return;}
 let assets:Asset[]=[];
 assets=await waitAssets(b.page,j.assetIds,j.baseline,1,()=>stopping,row.form.prompt);
 j.assetIds=assets.map(a=>a.id);await persist(`${requestId}.json`,j);await rpc('progress',{...identity,phase:'submitted',status:'قيد التنزيل',taskId:assets.map(a=>a.id).join(',')});
 for(const asset of assets){await mkdir(resolve(root,'downloads'),{recursive:true});const path=resolve(root,'downloads',`${requestId}-${j.files.length+1}.mp4`);await download(b.context,asset,path,b.page);await probe(path);j.files.push({assetId:asset.id,path});await persist(`${requestId}.json`,j);}
 j.phase='downloaded';await persist(`${requestId}.json`,j);await rpc('progress',{...identity,phase:'downloaded',status:'قيد التنزيل'});await upload(j,row);
 }catch(error){
 const raw=error instanceof Error?error.message:'Worker stopped';const message=raw.split('\n')[0].replace(/https?:\/\/\S+/g,'[URL]').slice(0,1000);
 if(j.phase==='intent'){j.phase='unknown';await persist(`${requestId}.json`,j);}
 if(row){await rpc('progress',{requestId,workerId:config.workerId,fence:j.fence,phase:j.phase,status:message.includes('LOGIN_REQUIRED')?'يحتاج تسجيل دخول':j.phase==='prepared'||/FLOW_BLOCKED|DOWNLOAD_FAILED|VIDEO_INVALID|UPLOAD_FAILED/.test(message)?'فشل':j.phase==='downloaded'?'قيد التنزيل':'قيد التوليد',error:message}).catch(()=>undefined);}
 if(b&&new URL(b.page.url()).hostname==='flow.google.com')await screenshot(b.page,`diagnostic-${requestId}.jpg`).catch(()=>undefined);
 console.log(message);process.exitCode=1;
 }finally{if(heartbeat)clearInterval(heartbeat);await persist('status.json',{pid:process.pid,requestId,at:new Date().toISOString(),state:'stopped',phase:j.phase});await unlock();}
}
const stopper=setInterval(()=>{stopRequested().then(value=>{if(value)stopping=true}).catch(()=>{stopping=true})},1000);
await main().catch(()=>{console.log('Worker command failed; inspect local status. Secrets are not logged.');process.exitCode=1;});clearInterval(stopper);process.exit(process.exitCode??0);
