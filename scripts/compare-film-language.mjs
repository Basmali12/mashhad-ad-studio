import process from 'node:process';import console from 'node:console';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {readFile,writeFile} from 'node:fs/promises';
const {fetch}=globalThis;
const exec=promisify(execFile),cli='node_modules/convex/bin/main.js';
if(!(await readFile('.env.local','utf8')).includes('dev:capable-cuttlefish-575'))throw new Error('Development only');
const env=async n=>(await exec(process.execPath,[cli,'env','get',n,'--deployment','dev'])).stdout.trim();
const identity=JSON.stringify({subject:await env('OWNER_SUBJECT'),issuer:await env('CLERK_JWT_ISSUER_DOMAIN')});
const run=async(name,args={})=>{try{const r=await exec(process.execPath,[cli,'run',name,JSON.stringify(args),'--identity',identity,'--deployment','dev'],{maxBuffer:4e6});return r.stdout.trim()?JSON.parse(r.stdout):null;}catch{throw new Error('Operation failed: '+name);}};
const file='outputs/film-language-comparison.json',mode=process.argv[2]??'--prepare';
if(mode==='--prepare'){
 const items=[];
 for(const lang of ['ar','en']){
  const projectId=await run('films:create',{key:'language-compare-20261006-'+lang,title:'مقارنة اللهجة العراقية — وصف '+(lang==='ar'?'فصحى':'إنكليزي')});
  await run('filmWorkshop:settings',{projectId,settings:{style:'واقعي',dialect:'العراقية',episodes:1,seconds:10}});
  const options=await run('filmProduction:options',{projectId});const option=options.options.find(o=>o.model==='Omni Flash'&&o.seconds===10&&o.resolution==='360p'&&o.aspect==='9:16');if(!option||option.cost>7)throw new Error('No approved-cost option available');
  const cast=await run('filmWorkshop:reference',{projectId,key:'zahraa',kind:'character',name:'زهراء',description:'امرأة عراقية بالغة بعمر 25 عامًا، شعر بني طويل، قميص أزرق بأكمام طويلة. صوت أنثوي عراقي طبيعي. لا أشخاص آخرين.'});
  const place=await run('filmWorkshop:reference',{projectId,key:'room',kind:'place',name:'غرفة هادئة',description:'غرفة بسيطة فيها نافذة يسار الشخصية، ضوء نهاري دافئ. دون لافتات أو كتابة.'});
  const plan={promptLanguage:lang,title:'لحظة اطمئنان',synopsis:'زهراء تنظر إلى النافذة ثم تلتفت نحو الكاميرا وتطمئن بصوت عراقي.',ending:'ابتسامة هادئة.',scenes:[{seconds:10,description:lang==='ar'?'لقطة متوسطة ثابتة، زهراء وحدها في الغرفة. خلال الثواني الثلاث الأولى تنظر إلى النافذة على يسارها. ثم تلتفت بهدوء نحو الكاميرا وتقول الحوار مرة واحدة، وبعده تبتسم. تظهر يداها بصورة طبيعية أسفل الصورة. لا تمسك هاتفًا ولا تدخل شخصية أخرى.':'Static medium shot. Zahraa is alone in the room. During the first three seconds she looks toward the window on her left. She then calmly turns toward the camera, speaks the approved line once, and smiles afterward. Her hands rest naturally at the bottom of the frame. She holds no phone. No other person enters.',dialogue:'زهراء: هسه ارتاحيت، كلشي تمام. باچر نكمل سوالفنا.',cast:[cast],place,continuity:lang==='ar'?'حافظ على القميص الأزرق ذي الأكمام الطويلة، والشعر البني، وموضع النافذة والإضاءة طوال اللقطة.':'Keep the long-sleeved blue shirt, brown hair, window position and lighting unchanged throughout the shot.'}]};
  let state=await run('filmWorkshop:state',{projectId});let episodeId=state.episodes.at(-1)?._id;if(!episodeId)episodeId=await run('filmWorkshop:manual',{projectId,episode:1,plan});episodeId=await run('filmWorkshop:save',{projectId,episodeId,plan,approve:true});
  const quote=await run('filmProduction:quote',{episodeId,option});if(quote.error||quote.total>7||!quote.sufficient)throw new Error('Quote unavailable or over budget');items.push({lang,projectId,episodeId,option,quote});
 }
 await writeFile(file,JSON.stringify({items,budget:14,referenceMode:'identical text descriptions; no uploaded reference images'},null,2));console.log(items.map(i=>({lang:i.lang,total:i.quote.total,flowCost:i.option.cost,online:i.quote.workerOnline})));
}else{
 const data=JSON.parse(await readFile(file,'utf8'));
 if(mode==='--generate'){
  if(!process.argv.includes('--approved-14'))throw new Error('Explicit current authorization required');
  for(const item of data.items){if(item.jobId)continue;const quote=await run('filmProduction:quote',{episodeId:item.episodeId,option:item.option});if(quote.error||quote.total>7||item.option.cost>7||!quote.workerOnline)throw new Error('Fresh quote or worker unavailable');item.jobId=await run('filmProduction:authorize',{episodeId:item.episodeId,option:item.option,key:'language-compare-20261006-'+item.lang,stamp:quote.stamp});await writeFile(file,JSON.stringify(data,null,2));console.log({lang:item.lang,jobId:item.jobId,reserved:quote.total});}
 }else if(mode==='--links'){const links=[];for(const item of data.items){if(!item.jobId)throw new Error('No saved generation');const link=await run('filmProduction:ownerDownload',{jobId:item.jobId});const check=await fetch(link.url,{method:'HEAD'});if(!check.ok||!check.headers.get('content-type')?.includes('video/mp4'))throw new Error('Download link unavailable');links.push({lang:item.lang,...link,status:check.status,type:check.headers.get('content-type'),bytes:check.headers.get('content-length')});}await writeFile('outputs/film-language-download-links.json',JSON.stringify(links,null,2));console.log(JSON.stringify(links,null,2));
 }else if(mode==='--status'){for(const item of data.items){const jobs=await run('filmProduction:list',{projectId:item.projectId});const j=jobs.find(j=>j._id===item.jobId);console.log({lang:item.lang,stage:j?.stage,paused:j?.paused,error:j?.error,spent:j?.spent,clips:j?.clips.map(c=>({state:c.state,storageId:c.storageId,duration:c.duration,review:c.review}))});console.log(JSON.stringify({lang:item.lang,finalId:j?.finalId,media:j?.media,review:j?.clips.map(c=>c.review)}));}}
 else throw new Error('Unknown mode');
}
