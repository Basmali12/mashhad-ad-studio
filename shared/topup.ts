export const topupPhone='+964 772 937 3260';
export function topupUrl(id?:string,points?:number){return `https://wa.me/9647729373260?text=${encodeURIComponent(`أريد شحن رصيد نقاط مشهد${id?`، معرّف حسابي: ${id}`:''}${Number.isSafeInteger(points)&&points!>0&&points!<=1000000?`، عدد النقاط المطلوب: ${points}`:''}.`)}`;}
