import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import process from 'node:process';
import {hash} from './store.mjs';
import {productionId,resolveProductionAsset,verifyProductionFile,validateProductionVideo} from './production-artifacts.mjs';

const exec=promisify(execFile),VERSION='final-film-quality-v1';
const THRESHOLDS=Object.freeze({blackSeconds:.5,blackPixelThreshold:.1,blackPictureThreshold:.98,freezeSeconds:2,freezeNoiseDb:-50,silenceSeconds:.75,silenceNoiseDb:-50,clippingPeakDb:.1,nearClippingDb:-.1,clippingPeakRatio:.001,driftMs:120});
const NUMBER='[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[-+]?\\d+)?';

function windows(value,durationMs){
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length>1000)throw Error('FINAL_QUALITY_INVALID_INPUT');
 return value.map(row=>{if(!row||Object.keys(row).some(k=>!['startMs','endMs'].includes(k))||!Number.isSafeInteger(row.startMs)||!Number.isSafeInteger(row.endMs)||row.startMs<0||row.endMs<=row.startMs||row.endMs>durationMs)throw Error('FINAL_QUALITY_INVALID_INPUT');return {startMs:row.startMs,endMs:row.endMs};}).sort((a,b)=>a.startMs-b.startMs||a.endMs-b.endMs);
}
function settingsOf(input){
 if(!input||Object.keys(input).some(k=>!['customerId','projectId','assetId','expectedDurationMs','expectedAudio','expectedWidth','expectedHeight','intentionalBlackIntervals','intentionalFreezeIntervals','intentionalSilenceIntervals','allowSilence'].includes(k))||!Number.isSafeInteger(input.expectedDurationMs)||input.expectedDurationMs<1||input.expectedDurationMs>3600000||typeof input.expectedAudio!=='boolean'||input.allowSilence!==undefined&&typeof input.allowSilence!=='boolean')throw Error('FINAL_QUALITY_INVALID_INPUT');
 for(const key of ['expectedWidth','expectedHeight'])if(input[key]!==undefined&&(!Number.isSafeInteger(input[key])||input[key]<2||input[key]>8192))throw Error('FINAL_QUALITY_INVALID_INPUT');
 return {version:VERSION,expectedDurationMs:input.expectedDurationMs,expectedAudio:input.expectedAudio,expectedWidth:input.expectedWidth??null,expectedHeight:input.expectedHeight??null,allowSilence:input.allowSilence===true,intentionalBlackIntervals:windows(input.intentionalBlackIntervals,input.expectedDurationMs),intentionalFreezeIntervals:windows(input.intentionalFreezeIntervals,input.expectedDurationMs),intentionalSilenceIntervals:windows(input.intentionalSilenceIntervals,input.expectedDurationMs),thresholds:THRESHOLDS};
}
function intervalsOf(stderr,kind,durationMs){
 const output=[];let pending=null;
 const interval=(start,end)=>{if(!Number.isFinite(start)||!Number.isFinite(end)||start<-.01||end<start||end>durationMs/1000+.25)throw Error('FINAL_QUALITY_INVALID_OBSERVATIONS');const startMs=Math.max(0,Math.round(start*1000)),endMs=Math.min(durationMs,Math.round(end*1000));if(endMs>startMs)output.push({startMs,endMs,durationMs:endMs-startMs});};
 for(const line of stderr.split(/\r?\n/)){
  if(!new RegExp('^\\[(?:Parsed_)?'+kind+'(?:_\\d+)?\\b[^\\]]*\\]').test(line))continue;
  const label=kind==='blackdetect'?'black':kind==='freezedetect'?'freeze':'silence';
  const start=line.match(new RegExp('\\b'+label+'_start:\\s*('+NUMBER+')','i')),end=line.match(new RegExp('\\b'+label+'_end:\\s*('+NUMBER+')','i'));
  if(line.includes(label+'_start:')&&!start||line.includes(label+'_end:')&&!end)throw Error('FINAL_QUALITY_INVALID_OBSERVATIONS');
  if(start){if(pending!==null)throw Error('FINAL_QUALITY_INVALID_OBSERVATIONS');pending=Number(start[1]);}
  if(end){if(pending===null)throw Error('FINAL_QUALITY_INVALID_OBSERVATIONS');interval(pending,Number(end[1]));pending=null;}
 }
 // freezedetect may report a final start without an end when EOF is reached.
 if(pending!==null)interval(pending,durationMs/1000);
 return output;
}
function audioStats(stderr){
 const rows=stderr.split(/\r?\n/).filter(l=>/^\[(?:Parsed_)?astats(?:_\d+)?\b[^\]]*\]/.test(l));
 let peakLevelDb=null,peakCount=null,sampleCount=null;
 for(const line of rows){let value=line.match(new RegExp('Peak level dB:\\s*('+NUMBER+')','i'));if(value)peakLevelDb=Number(value[1]);value=line.match(new RegExp('Peak count:\\s*('+NUMBER+')','i'));if(value)peakCount=Number(value[1]);value=line.match(/Number of samples:\s*(\d+)/i);if(value)sampleCount=Number(value[1]);}
 if([peakLevelDb,peakCount,sampleCount].some(v=>v!==null&&!Number.isFinite(v))||peakCount!==null&&peakCount<0||sampleCount!==null&&(!Number.isSafeInteger(sampleCount)||sampleCount<1))throw Error('FINAL_QUALITY_INVALID_OBSERVATIONS');
 const clippingRatio=peakCount!==null&&sampleCount!==null?peakCount/sampleCount:null,measured=sampleCount!==null,suspected=peakLevelDb!==null&&(peakLevelDb>THRESHOLDS.clippingPeakDb||peakLevelDb>=THRESHOLDS.nearClippingDb&&clippingRatio!==null&&clippingRatio>=THRESHOLDS.clippingPeakRatio);
 return {peakLevelDb,peakCount,sampleCount,clippingRatio,audioClippingStatus:!measured?'not_measured':suspected?'suspected':'no_evidence'};
}
function metadataOf(result,expected){
 if(!result||typeof result.stdout!=='string'||typeof result.stderr!=='string'||result.stdout.length>16*1024*1024||result.stderr.length>16*1024*1024)throw Error('FINAL_QUALITY_INVALID_OBSERVATIONS');
 const input=result.stderr.split(/Output #/)[0],videos=[...input.matchAll(/Stream[^\n]*Video: ([^\n]+)/g)],audios=[...input.matchAll(/Stream[^\n]*Audio: ([^\n]+)/g)];
 if(videos.length!==1||audios.length>1||expected.expectedAudio&&audios.length!==1)throw Error('FINAL_QUALITY_VIDEO_INVALID');
 const size=videos[0][1].match(/\b(\d{2,5})x(\d{2,5})\b/),fps=videos[0][1].match(/(\d+(?:\.\d+)?) fps/),clock=[...result.stdout.matchAll(/^out_time_us=(\d+)$/gm)].at(-1),frames=[...result.stdout.matchAll(/^frame=\s*(\d+)$/gm)].at(-1);
 if(!size||!fps||!clock||!frames||Number(fps[1])<1||Number(fps[1])>120)throw Error('FINAL_QUALITY_VIDEO_INVALID');
 const checked=validateProductionVideo({durationMs:Number(clock[1])/1000,width:Number(size[1]),height:Number(size[2]),hasAudio:audios.length===1,fps:Number(fps[1]),checker:'ffmpeg_full_decode_and_quality_filters'},expected.expectedDurationMs,{requireAudio:expected.expectedAudio});
 if(expected.expectedWidth!==null&&expected.expectedWidth!==checked.width||expected.expectedHeight!==null&&expected.expectedHeight!==checked.height)throw Error('FINAL_QUALITY_DIMENSION_MISMATCH');
 const sampleRate=audios[0]?.[1].match(/\b(\d+) Hz\b/),decodedVideoMs=Math.round(Number(frames[1])*1000/checked.fps);
 return {...checked,decodedVideoMs,sampleRate:sampleRate?Number(sampleRate[1]):null};
}
const intentional=(interval,allowed)=>allowed.some(w=>interval.startMs>=w.startMs-50&&interval.endMs<=w.endMs+50);

/** Local CPU observations on immutable owned output, not semantic certification.
 * `runner(args,{ffmpeg,timeout})` is an injectable process boundary for tests.
 * Its production default uses execFile (no shell) with bounded stdout/stderr.
 */
export function createFinalFilmQuality({store,now=Date.now,runner=null,ffmpeg=process.env.FILM_FFMPEG_PATH||process.env.ENGINE_FFMPEG_BIN||'ffmpeg',verifyVideo=null}={}){
 const pending=new Map();
 const owned=async(customerId,projectId)=>{if(!productionId(customerId)||!productionId(projectId))throw Error('NOT_FOUND');const p=await store.get('production-project',projectId);if(!p||p.customerId!==customerId)throw Error('NOT_FOUND');return p;};
 const resolve=async(input)=>{await owned(input.customerId,input.projectId);return resolveProductionAsset({store,customerId:input.customerId,projectId:input.projectId,assetId:input.assetId});};
 const safe=row=>({id:row.id,assetId:row.assetId,sourceSHA256:row.sourceSHA256,settingsFingerprint:row.settingsFingerprint,checkedAt:row.checkedAt,status:row.review?.accepted===true?'reviewed':'needs_review',needsReview:row.review?.accepted!==true,reviewed:row.review?.reviewed===true,reviewedAt:row.review?.reviewedAt??null,findings:row.findings,quality:{...row.quality,humanReviewed:row.review?.reviewed===true},measurements:row.measurements});
 async function inspect(input){
  const settings=settingsOf(input),source=await resolve(input),settingsFingerprint=hash(JSON.stringify(settings)),id=hash(VERSION+':'+input.customerId+':'+input.projectId+':'+input.assetId+':'+source.sha256+':'+settingsFingerprint),cached=await store.get('production-quality',id);
  if(cached){if(cached.customerId!==input.customerId||cached.projectId!==input.projectId||cached.sourceSHA256!==source.sha256||cached.settingsFingerprint!==settingsFingerprint)throw Error('FINAL_QUALITY_SCOPE_CHANGED');return safe(cached);}
  if(pending.has(id))return pending.get(id);
  const promise=(async()=>{
   const audio=settings.expectedAudio||source.hasAudio===true,args=['-nostdin','-hide_banner','-loglevel','info','-xerror','-err_detect','explode','-threads','2','-filter_threads','1','-protocol_whitelist','file,pipe','-i',source.path,'-map','0:v:0','-map',settings.expectedAudio?'0:a:0':'0:a:0?','-vf',`blackdetect=d=${THRESHOLDS.blackSeconds}:pix_th=${THRESHOLDS.blackPixelThreshold}:pic_th=${THRESHOLDS.blackPictureThreshold},freezedetect=n=${THRESHOLDS.freezeNoiseDb}dB:d=${THRESHOLDS.freezeSeconds}`,...(audio?['-af',`silencedetect=noise=${THRESHOLDS.silenceNoiseDb}dB:d=${THRESHOLDS.silenceSeconds},astats=metadata=1:reset=0`]:[]),'-progress','pipe:1','-nostats','-f','null','-'];
   const timeout=Math.min(7200000,Math.max(120000,settings.expectedDurationMs*4));let decoded;
   try{decoded=runner?await runner(args,{ffmpeg,timeout}):await exec(ffmpeg,args,{windowsHide:true,timeout,maxBuffer:16*1024*1024});}catch(e){throw Error(e.code==='ENOENT'?'FINAL_QUALITY_TOOL_UNAVAILABLE':'FINAL_QUALITY_DECODE_FAILED',{cause:e});}
   const metadata=metadataOf(decoded,settings);if(verifyVideo){const verified=await verifyVideo({file:source.path,expectedDurationMs:settings.expectedDurationMs,hasAudio:settings.expectedAudio,ffmpeg});if(verified.width!==metadata.width||verified.height!==metadata.height||verified.hasAudio!==metadata.hasAudio)throw Error('FINAL_QUALITY_VERIFIER_MISMATCH');}
   await verifyProductionFile(source.path,source.sha256);
   const duration=metadata.durationMs,mark=(rows,allowed)=>rows.map(row=>({...row,intentional:intentional(row,allowed)})),blackIntervals=mark(intervalsOf(decoded.stderr,'blackdetect',duration),settings.intentionalBlackIntervals),freezeIntervals=mark(intervalsOf(decoded.stderr,'freezedetect',duration),settings.intentionalFreezeIntervals),silenceIntervals=mark(intervalsOf(decoded.stderr,'silencedetect',duration),settings.intentionalSilenceIntervals),stats=audioStats(decoded.stderr),findings=[];
   for(const [code,rows] of [['BLACK_INTERVAL',blackIntervals],['FROZEN_FRAMES',freezeIntervals],['AUDIO_SILENCE',silenceIntervals]])for(const interval of rows)if(!interval.intentional&&!(code==='AUDIO_SILENCE'&&settings.allowSilence))findings.push({code,severity:'review',startMs:interval.startMs,endMs:interval.endMs,durationMs:interval.durationMs});
   if(metadata.hasAudio&&stats.audioClippingStatus==='not_measured')findings.push({code:'AUDIO_STATS_UNAVAILABLE',severity:'review'});
   if(stats.audioClippingStatus==='suspected')findings.push({code:'AUDIO_CLIPPING_SUSPECTED',severity:'review',value:stats.peakLevelDb});
   const measuredAudioMs=metadata.sampleRate&&stats.sampleCount?Math.round(stats.sampleCount*1000/metadata.sampleRate):null;
   if(measuredAudioMs!==null&&Math.abs(measuredAudioMs-metadata.decodedVideoMs)>THRESHOLDS.driftMs)findings.push({code:'AUDIO_VIDEO_DURATION_DRIFT',severity:'review',value:measuredAudioMs-metadata.decodedVideoMs});
   findings.push({code:'SEMANTIC_QUALITY_UNVERIFIED',severity:'review'});
   const row={id,customerId:input.customerId,projectId:input.projectId,assetId:input.assetId,sourceSHA256:source.sha256,sourceBytes:source.bytes,settings,settingsFingerprint,checkedAt:now(),findings,quality:{structuralVerified:true,observationsCompleted:true,visualQualityCertified:false,voiceIdentityVerified:false,dialectVerified:false,lipSynchronizationVerified:false,humanReviewed:false,decodedDurationMs:duration,width:metadata.width,height:metadata.height,fps:metadata.fps,hasAudio:metadata.hasAudio},measurements:{blackIntervals,freezeIntervals,silenceIntervals,...stats,measuredAudioMs,decodedVideoMs:metadata.decodedVideoMs},review:null};
   await store.transaction(async()=>{await owned(input.customerId,input.projectId);const current=await store.get('production-asset',input.assetId);if(!current||current.customerId!==input.customerId||current.projectId!==input.projectId||current.sha256!==source.sha256)throw Error('FINAL_QUALITY_SOURCE_CHANGED');const prior=await store.get('production-quality',id);if(!prior)await store.put('production-quality',row);});return safe(await store.get('production-quality',id));
  })();pending.set(id,promise);try{return await promise;}finally{pending.delete(id);}
 }
 async function current(customerId,projectId,assetId){const source=await resolve({customerId,projectId,assetId}),rows=(await store.all('production-quality')).filter(r=>r.customerId===customerId&&r.projectId===projectId&&r.assetId===assetId&&r.sourceSHA256===source.sha256).sort((a,b)=>b.checkedAt-a.checkedAt||b.id.localeCompare(a.id));if(!rows.length)throw Error('NOT_FOUND');return {source,row:rows[0]};}
 return {inspect,async read(customerId,projectId,assetId){return safe((await current(customerId,projectId,assetId)).row);},async review({actor,customerId,projectId,assetId,reviewed,accepted}){
  if(!actor||actor.isAdmin!==true&&actor.customerId!==customerId&&actor.id!==customerId)throw Error('FORBIDDEN');if(reviewed!==true||accepted!==true)throw Error('FINAL_QUALITY_REVIEW_REQUIRED');const {source,row}=await current(customerId,projectId,assetId);
  await store.transaction(async()=>{await owned(customerId,projectId);const fresh=await store.get('production-quality',row.id);if(!fresh||fresh.sourceSHA256!==source.sha256||fresh.settingsFingerprint!==row.settingsFingerprint)throw Error('FINAL_QUALITY_SOURCE_CHANGED');if(!fresh.review){fresh.review={reviewed:true,accepted:true,reviewedAt:now(),reviewerId:productionId(actor.id)?actor.id:actor.isAdmin?'administrator':customerId,sourceSHA256:source.sha256,settingsFingerprint:row.settingsFingerprint};await store.put('production-quality',fresh);await store.audit('final_film_quality_reviewed',fresh.id);}});return safe(await store.get('production-quality',row.id));
 }};
}
