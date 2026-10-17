import process from 'node:process';
import console from 'node:console';
// Operator-only Development verification. Never enqueues generation or calls an AI API.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const exec=promisify(execFile),cli='node_modules/convex/bin/main.js';
if(!(await readFile('.env.local','utf8')).includes('dev:capable-cuttlefish-575'))throw new Error('Development configuration required');
const env=async name=>(await exec(process.execPath,[cli,'env','get',name,'--deployment','dev'],{maxBuffer:1024*1024})).stdout.trim();
const identity=JSON.stringify({subject:await env('OWNER_SUBJECT'),issuer:await env('CLERK_JWT_ISSUER_DOMAIN')});
async function run(name,args){const r=await exec(process.execPath,[cli,'run',name,JSON.stringify(args),'--identity',identity,'--deployment','dev'],{maxBuffer:4*1024*1024});return r.stdout.trim()?JSON.parse(r.stdout):null;}
const projectId=await run('films:create',{key:'stage56-existing-16-v1',title:'اختبار مونتاج فقط — فيديو محفوظ 16 ثانية'});
await run('filmWorkshop:settings',{projectId,settings:{style:'واقعي',dialect:'العراقية',episodes:1,seconds:16}});
const cast=await run('filmWorkshop:reference',{projectId,key:'source-cast',kind:'character',name:'شخصيات المصدر الموجود',description:'لا توليد جديد ولا ادعاء مطابقة قصة جديدة؛ اختبار مونتاج فقط.'});
const place=await run('filmWorkshop:reference',{projectId,key:'source-place',kind:'place',name:'مكان الفيديو الموجود',description:'المصدر محفوظ سابقًا، دون إضافة كتابة أو شعار.'});
const plan={title:'اختبار تركيب واستئناف — مقاطع محفوظة',synopsis:'اختبار تقني للمونتاج فقط، ليس فيلمًا جديدًا مولدًا.',ending:'نهاية المصدر الأصلي.',scenes:[{seconds:8,description:'النصف الأول من الفيديو الموجود.',dialogue:'الصوت الأصلي فقط.',cast:[cast],place,continuity:'المصدر نفسه.'},{seconds:8,description:'النصف الثاني من الفيديو الموجود دون تكرار.',dialogue:'الصوت الأصلي فقط.',cast:[cast],place,continuity:'تتابع النصف الأول دون شعار جديد أو كتابة.'}]};
const state=await run('filmWorkshop:state',{projectId});let episode=state.episodes.sort((a,b)=>b.version-a.version)[0];if(!episode){const id=await run('filmWorkshop:manual',{projectId,episode:1,plan});episode={_id:id,approved:false};}if(!episode.approved)episode={_id:await run('filmWorkshop:save',{projectId,episodeId:episode._id,plan,approve:true}),approved:true};
const parts=[{storageId:'kg20j953haqw32yj37ekqyve0d8fnbmt',start:0,end:8},{storageId:'kg20j953haqw32yj37ekqyve0d8fnbmt',start:8,end:16}];
const args={episodeId:episode._id,key:'existing-16-safe-test',parts},jobId=await run('filmProduction:assembleExisting',args);if(await run('filmProduction:assembleExisting',args)!==jobId)throw new Error('Duplicate montage job');
if(process.argv.includes('--resume'))await run('filmProduction:resume',{jobId,reserveAgain:false});
const jobs=await run('filmProduction:list',{projectId}),job=jobs.find(j=>j._id===jobId);if(job?.mode!=='existing'||job.spent||job.reserved)throw new Error('Not a zero-generation test');
await mkdir('outputs',{recursive:true});await writeFile('outputs/film-existing-check.json',JSON.stringify({projectId,jobId,stage:job.stage,finalId:job.finalId,media:job.media},null,2));console.log({projectId,jobId,stage:job.stage,points:0});


