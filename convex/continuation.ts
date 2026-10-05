import {ConvexError} from 'convex/values';
import type {MutationCtx} from './_generated/server';
import {validateEdit,type EditSettings} from '../shared/editing';
import type {Template} from '../shared/pipeline';
export interface ContinuationSource {storageId:string;duration:number;width:number;height:number}
// Duration comes from a previously verified export/source, never the browser.
export async function continuationSource(ctx:MutationCtx,id:string|undefined,aspect:string){
 if(!id)return undefined;
 const storageId=ctx.db.system.normalizeId('_storage',id),file=storageId?await ctx.db.query('uploads').withIndex('by_storage',q=>q.eq('storageId',storageId)).unique():null;
 if(!storageId||file?.kind!=='video')throw new ConvexError('فيديو التكملة غير محفوظ أو غير مصرح له.');
 const final=(await ctx.db.query('exports').collect()).find(e=>e.fileId===storageId&&e.status==='completed');
 const media=final?.media??(await ctx.db.query('requests').collect()).flatMap(r=>r.results??[]).find(r=>r.storageId===storageId);
 if(!media||!Number.isFinite(media.duration)||media.duration<.5||media.duration>180||![media.width,media.height].every(n=>Number.isSafeInteger(n)&&n>0))throw new ConvexError('مدة فيديو البداية غير متحققة؛ لا يمكن دمجه بأمان.');
 if(Math.abs(media.width/media.height-(aspect==='16:9'?16/9:9/16))>.02)throw new ConvexError('مقاس فيديو البداية لا يطابق التكملة.');
 return {storageId,duration:media.duration,width:media.width,height:media.height};
}
export function continuationEdit(template:Template,clips:EditSettings['clips'],newDuration:number,source?:ContinuationSource):EditSettings{
 const duration=newDuration+(source?.duration??0);
 const settings={...template,logo:{...template.logo,end:template.logo.end===newDuration?duration:template.logo.end},clips:[...(source?[{storageId:source.storageId,start:0,end:source.duration}]:[]),...clips],duration,transition:0};
 validateEdit(settings);return settings;
}
