import {v} from 'convex/values';
export const IMAGE_DEFAULT_POINTS=1;
export function imagePoints(rate?:{points:number;source?:string}){return rate?.source==='manual'?rate.points:IMAGE_DEFAULT_POINTS;}
export const imageModels=['Nano Banana Pro','Nano Banana 2','Nano Banana 2 Lite'] as const;
export const imageAspects=['9:16','3:4','1:1','4:3','16:9'] as const;
export type ImageOption={model:string;aspect:string;cost:number};
export const imageOptionValidator=v.object({model:v.string(),aspect:v.string(),cost:v.number()});
export const imageStatusValidator=v.union(...['queued','generating','downloading','uploading','completed','failed','login','uncertain','stopped'].map(s=>v.literal(s)));
export function validateImageOption(o:ImageOption){if(!imageModels.some(m=>m===o.model)||!imageAspects.some(a=>a===o.aspect)||!Number.isSafeInteger(o.cost)||o.cost<0||o.cost>1000000)throw new Error('خيارات الصورة غير صالحة.');}
