import {assertBannerDimensions} from '../shared/site-banner';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {assertReelDuration,ReelVideoError} from '../shared/reels-video';
const exec=promisify(execFile);
export function reelProbeDuration(data:unknown){
 const probe=data as {format?:{duration?:unknown};streams?:{codec_type?:string;duration?:unknown}[]}|null;
 if(!probe||!Array.isArray(probe.streams)||!probe.streams.some(s=>s.codec_type==='video'))throw new ReelVideoError('الملف لا يحتوي مسار فيديو صالحاً.');
 const duration=assertReelDuration(Number(probe.format?.duration));
 for(const stream of probe.streams){if(!['video','audio'].includes(stream.codec_type??''))continue;const value=stream.duration;if(value!==undefined&&value!=='N/A')assertReelDuration(Number(value));}
 return duration;
}
// Probe only the received local file, before Bunny PUT or quota acceptance.
export async function probeReelFile(path:string,executable=process.env.MASHHAD_FFPROBE_PATH??'ffprobe'){
 let output:string;
 try{const result=await exec(executable,['-v','error','-protocol_whitelist','file','-show_entries','format=duration:stream=codec_type,duration','-of','json',path],{timeout:15000,maxBuffer:262144,windowsHide:true});output=result.stdout;}catch{throw new ReelVideoError('تعذر فحص مدة الفيديو على الخادم؛ لم يُقبل الرفع.');}
 let data:unknown;try{data=JSON.parse(output);}catch{throw new ReelVideoError('تعذر التحقق من معلومات الفيديو.');}
 return reelProbeDuration(data);
}

export async function probeBannerImage(path:string,executable=process.env.MASHHAD_FFPROBE_PATH??'ffprobe'){
 let data:{streams?:{codec_type?:string;codec_name?:string;width?:number;height?:number}[]};
 try{const result=await exec(executable,['-v','error','-protocol_whitelist','file','-show_entries','stream=codec_type,codec_name,width,height','-of','json',path],{timeout:15000,maxBuffer:262144,windowsHide:true});data=JSON.parse(result.stdout);}catch{throw new ReelVideoError('تعذر فحص صورة الإعلان على الخادم.');}
 const streams=data.streams,stream=streams?.[0];if(!stream||streams?.length!==1||stream.codec_type!=='video'||!['png','mjpeg','webp'].includes(stream.codec_name??''))throw new ReelVideoError('اختَر صورة إعلان JPG أو PNG أو WebP صالحة.');
 try{assertBannerDimensions(stream.width??0,stream.height??0);}catch(e){throw new ReelVideoError((e as Error).message);}
}
