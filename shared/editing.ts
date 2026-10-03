export interface EditSettings {
 aspect?:"9:16"|"16:9";
 clips:{storageId:string;start:number;end:number}[];
 duration:number; transition:number; fit:'contain'|'crop'; width:720|360;
 logo:{enabled:boolean;position:'top-right'|'top-left'|'bottom-right'|'bottom-left';size:number;start:number;end:number};
 text:{name:boolean;address:boolean;phone:boolean;position:'top'|'bottom';color:string;background:string};
}
export const exportPhases={queued:'بانتظار المونتاج',preparing:'تجهيز الملفات',merging:'دمج',overlay:'تركيب الشعار والنصوص',encoding:'تصدير',verifying:'تحقق',uploading:'رفع',completed:'مكتمل',failed:'فشل'} as const;
export type ExportPhase=keyof typeof exportPhases;
// Canonical keys keep retry identity stable when Convex reorders object fields.
export function canonical(value:unknown){return JSON.stringify(value,(_key:string,v:unknown)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0)):v);}
export function availableDuration(s:EditSettings){return s.clips.reduce((n,c)=>n+c.end-c.start,0)-s.transition*Math.max(0,s.clips.length-1);}
export function validateEdit(s:EditSettings){
 const number=(n:number,min:number,max:number)=>Number.isFinite(n)&&n>=min&&n<=max;
 if(!s.clips.length||s.clips.length>20||!number(s.duration,.5,180)||!number(s.transition,0,1)||!['contain','crop'].includes(s.fit)||![360,720].includes(s.width))throw new Error('إعدادات المونتاج غير صالحة.');
 for(const c of s.clips)if(!c.storageId||!number(c.start,0,600)||!number(c.end,0,600)||c.end-c.start<.5||s.transition>=(c.end-c.start)/2)throw new Error('تحقق من القص؛ يجب أن يبقى نصف ثانية وأن يكون الانتقال أقصر من نصف المقطع.');
 if(s.duration>availableDuration(s)+.04)throw new Error(`المقاطع لا تكفي: المتاح ${availableDuration(s).toFixed(2)} ثانية، النقص ${(s.duration-availableDuration(s)).toFixed(2)} ثانية. لن تُكرر أو تُبطأ المقاطع.`);
 if(!number(s.logo.size,5,35)||!number(s.logo.start,0,180)||!number(s.logo.end,0,180)||s.logo.end<=s.logo.start||!['top-right','top-left','bottom-right','bottom-left'].includes(s.logo.position))throw new Error('إعدادات الشعار غير صالحة.');
 if(!['top','bottom'].includes(s.text.position)||![s.text.color,s.text.background].every(c=>/^#[a-fA-F0-9]{6}$/.test(c)))throw new Error('إعدادات النص غير صالحة.');
}

export function editDimensions(s:Pick<EditSettings,"width"|"aspect">){return s.aspect==="16:9"?{width:s.width/9*16,height:s.width}:{width:s.width,height:s.width/9*16};}
