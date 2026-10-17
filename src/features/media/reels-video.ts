import {assertReelDuration,ReelVideoError} from '../../../shared/reels-video';
// Local metadata only: no upload, quota reservation or full-file buffering.
export function validateReelFile(file:File):Promise<number>{
 if(file.type!=='video/mp4')return Promise.reject(new ReelVideoError('اختَر فيديو بصيغة MP4.'));
 return new Promise((resolve,reject)=>{
  const video=document.createElement('video'),url=URL.createObjectURL(file);
  const timer=setTimeout(()=>finish(new ReelVideoError('تعذر قراءة مدة الفيديو. جرّب ملف MP4 صالحاً.')),15000);
  function finish(error?:Error){clearTimeout(timer);video.onloadedmetadata=null;video.onerror=null;video.removeAttribute('src');video.load();URL.revokeObjectURL(url);if(error)reject(error);}
  video.preload='metadata';
  video.onerror=()=>finish(new ReelVideoError('تعذر قراءة مدة الفيديو. جرّب ملف MP4 صالحاً.'));
  video.onloadedmetadata=()=>{try{const duration=assertReelDuration(video.duration);finish();resolve(duration);}catch(e){finish(e as Error);}};
  video.src=url;
 });
}
