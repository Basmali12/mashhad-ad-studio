export const MAX_REEL_SECONDS=180;
export class ReelVideoError extends Error {}
export function assertReelDuration(seconds:number){
 if(!Number.isFinite(seconds)||seconds<=0)throw new ReelVideoError('تعذر التأكد من مدة الفيديو. اختَر ملف MP4 صالحاً.');
 if(seconds>MAX_REEL_SECONDS)throw new ReelVideoError('مدة الريلز لا تتجاوز 3 دقائق (180 ثانية). اختَر فيديو أقصر.');
 return seconds;
}
