import process from 'node:process';
import console from 'node:console';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile} from 'node:fs/promises';
const exec=promisify(execFile),cli='node_modules/convex/bin/main.js';
if(!(await readFile('.env.local','utf8')).includes('dev:capable-cuttlefish-575'))throw new Error('Development only');
const env=async name=>(await exec(process.execPath,[cli,'env','get',name,'--deployment','dev'])).stdout.trim();
const identity=JSON.stringify({subject:await env('OWNER_SUBJECT'),issuer:await env('CLERK_JWT_ISSUER_DOMAIN')});
const run=async(name,args={})=>{const r=await exec(process.execPath,[cli,'run',name,JSON.stringify(args),...(name.endsWith(':next')?[]:['--identity',identity]),'--deployment','dev'],{maxBuffer:4*1024*1024});return r.stdout.trim()?JSON.parse(r.stdout):null;};
if(process.argv.includes('--create')){
 const projectId=await run('films:create',{key:'folder-existing-safe-v1',title:'اختبار حافظة ودمج — مقاطع موجودة فقط'});
 await run('filmWorkshop:settings',{projectId,settings:{style:'واقعي',dialect:'العراقية',episodes:1,seconds:16}});
 const cast=await run('filmWorkshop:reference',{projectId,key:'source-cast',kind:'character',name:'شخصيات المصدر المحفوظ',description:'اختبار المونتاج فقط دون توليد أو تغيير الشخصيات.'});
 const place=await run('filmWorkshop:reference',{projectId,key:'source-place',kind:'place',name:'مكان المصدر المحفوظ',description:'لا تغيير للمصدر؛ لا توليد جديد.'});
 const plan={title:'اختبار الحافظة والدمج اليدوي',synopsis:'تقسيم مصدر محفوظ ثم دمجه دون تكرار؛ ليس توليدًا جديدًا.',ending:'نهاية المصدر الأصلي.',scenes:[{seconds:8,description:'الثواني الأولى من المصدر الموجود.',dialogue:'الصوت الأصلي فقط.',cast:[cast],place,continuity:'نفس المصدر.'},{seconds:8,description:'الثواني التالية من المصدر الموجود.',dialogue:'الصوت الأصلي فقط.',cast:[cast],place,continuity:'تكملة المصدر دون تكرار.'}]};
 let {episodes}=await run('filmWorkshop:state',{projectId});let episode=episodes.at(-1);if(!episode){const id=await run('filmWorkshop:manual',{projectId,episode:1,plan});episode={_id:id,approved:false};}if(!episode.approved)episode={_id:await run('filmWorkshop:save',{projectId,episodeId:episode._id,plan,approve:true})};
 const args={episodeId:episode._id,key:'folder-existing-safe-v1',manualMerge:true,parts:[{storageId:'kg20j953haqw32yj37ekqyve0d8fnbmt',start:0,end:8},{storageId:'kg20j953haqw32yj37ekqyve0d8fnbmt',start:8,end:16}]};
 const before=await run('wallets:mine');const jobId=await run('filmProduction:assembleExisting',args);if(await run('filmProduction:assembleExisting',args)!==jobId)throw new Error('Duplicate creation');
 const after=await run('wallets:mine');if(after.wallet.balance!==before.wallet.balance||after.ledger.length!==before.ledger.length)throw new Error('Unexpected wallet change');
 await writeFile('outputs/film-folder-existing.json',JSON.stringify({projectId,jobId,balanceBefore:before.wallet.balance,ledgerBefore:before.ledger.length},null,2));console.log({projectId,jobId,balanceUnchanged:true});
}else if(process.argv.includes('--merge-twice')){const {jobId}=JSON.parse(await readFile('outputs/film-folder-existing.json','utf8'));console.log({first:await run('filmProduction:merge',{jobId}),second:await run('filmProduction:merge',{jobId})});
}else if(process.argv.includes('--status')){
 const p=JSON.parse(await readFile('outputs/film-folder-existing.json','utf8'));const jobs=await run('filmProduction:list',{projectId:p.projectId});const j=jobs.find(j=>j._id===p.jobId);const w=await run('wallets:mine');console.log({jobId:j._id,stage:j.stage,paused:j.paused,error:j.error,mode:j.mode,manualMerge:j.manualMerge,mergeRequested:j.mergeRequested,clips:j.clips.map(c=>({index:c.index,state:c.state,storageId:c.storageId})),finalId:j.finalId,media:j.media,balanceUnchanged:w.wallet.balance===p.balanceBefore,ledgerUnchanged:w.ledger.length===p.ledgerBefore});
}else{console.log({filmNext:await run('filmProduction:next'),pipelineNext:await run('pipeline:next')});}
