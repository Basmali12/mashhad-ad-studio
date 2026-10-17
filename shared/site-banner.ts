export const MAX_BANNER_BYTES=2*1024*1024;
export const BANNER_TYPES=['image/jpeg','image/png','image/webp'];
export function validBannerFile(type:string,size:number){return BANNER_TYPES.includes(type)&&Number.isSafeInteger(size)&&size>=12&&size<=MAX_BANNER_BYTES;}
export function assertBannerDimensions(width:number,height:number){if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||height<1||width<=height||width>6000||height>3000)throw Error('اختَر صورة أفقية حتى 6000 × 3000 بكسل.');}
