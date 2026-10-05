import {v,ConvexError} from 'convex/values';
import {query,mutation,type MutationCtx} from './_generated/server';
import {requireOwner} from './access';
const notesValidator=v.object({portrait:v.string(),landscape:v.string()});
const checkNotes=(notes:{portrait:string;landscape:string}|undefined)=>{if(notes&&(notes.portrait.length>4000||notes.landscape.length>4000))throw new ConvexError('وصف الصور طويل جدًا.');};
const referenceValidator=v.array(v.object({slot:v.number(),aspect:v.optional(v.union(v.literal('9:16'),v.literal('16:9'))),storageId:v.id('_storage')}));
async function validateReferences(ctx:MutationCtx,references:{slot:number;aspect?:'9:16'|'16:9';storageId:import('./_generated/dataModel').Id<'_storage'>}[]){
 if(references.length>16||new Set(references.map(r=>`${r.aspect??'9:16'}:${r.slot}`)).size!==references.length)throw new ConvexError('صور المكان لا تزيد عن ثماني خانات مختلفة لكل مقاس.');
 for(const r of references){if(!Number.isInteger(r.slot)||r.slot<0||r.slot>7)throw new ConvexError('خانة الصورة غير صالحة.');const f=await ctx.db.query('uploads').withIndex('by_storage',q=>q.eq('storageId',r.storageId)).unique();if(!f||f.kind!=='image')throw new ConvexError('الصورة لم يكتمل رفعها.');}
}
export const savePhotos=mutation({args:{references:referenceValidator,referenceNotes:v.optional(notesValidator)},handler:async(ctx,a)=>{await requireOwner(ctx);checkNotes(a.referenceNotes);await validateReferences(ctx,a.references);const previous=await ctx.db.query('branding').withIndex('by_key',q=>q.eq('key','owner')).unique();if(previous){await ctx.db.patch(previous._id,{references:a.references,referenceNotes:a.referenceNotes??previous.referenceNotes,updatedAt:Date.now()});return previous._id;}return ctx.db.insert('branding',{key:'owner',name:'',address:'',phone:'',logoEnabled:false,references:a.references,referenceNotes:a.referenceNotes,updatedAt:Date.now()});}});
export const branding=query({args:{},handler:async ctx=>{await requireOwner(ctx);return ctx.db.query('branding').withIndex('by_key',q=>q.eq('key','owner')).unique();}});
export const saveBranding=mutation({args:{name:v.string(),address:v.string(),phone:v.string(),logoId:v.optional(v.id('_storage')),logoEnabled:v.boolean(),referenceNotes:v.optional(notesValidator),references:v.optional(v.array(v.object({slot:v.number(),aspect:v.optional(v.union(v.literal('9:16'),v.literal('16:9'))),storageId:v.id('_storage')})))},handler:async(ctx,a)=>{
 await requireOwner(ctx);checkNotes(a.referenceNotes);if(a.name.length>120||a.address.length>500||a.phone.length>40)throw new ConvexError('بيانات الهوية طويلة جدًا.');
 if(a.logoEnabled&&!a.logoId)throw new ConvexError('ارفع شعارًا أولًا.');
 if(a.logoId){const f=await ctx.db.query('uploads').withIndex('by_storage',q=>q.eq('storageId',a.logoId)).unique();if(!f||f.kind!=='image'||!['image/png','image/webp'].includes(f.type))throw new ConvexError('الشعار يجب أن يكون PNG أو WebP محفوظًا.');}
 await validateReferences(ctx,a.references??[]);
 const previous=await ctx.db.query('branding').withIndex('by_key',q=>q.eq('key','owner')).unique();const value={...a,referenceNotes:a.referenceNotes??previous?.referenceNotes,references:a.references??previous?.references??[],updatedAt:Date.now()};if(previous){await ctx.db.patch(previous._id,value);return previous._id;}return ctx.db.insert('branding',{key:'owner',...value});
}});
export const gallery=query({args:{},handler:async ctx=>{
 await requireOwner(ctx);const requests=await ctx.db.query('requests').order('desc').collect(),exports=await ctx.db.query('exports').order('desc').collect();
 return requests.flatMap(r=>{const final=exports.find(e=>e.requestId===r._id&&e.status==='completed'&&e.fileId);if(!final&&r.status!=='مكتمل')return [];const source=r.results?.[0];const storageId=final?.fileId??r.videoId??source?.storageId;if(!storageId)return [];const repair=exports.find(e=>e.requestId===r._id&&e.key===`continuation-repair-${r._id}`);const processing=!!repair&&!['completed','failed'].includes(repair.status);return [{processing,requestId:r._id,storageId,name:r.form.name,createdAt:final?.endedAt??r.createdAt,duration:final?.media?.duration??source?.duration??null,width:final?.media?.width??source?.width??null,height:final?.media?.height??source?.height??null,final:!!final,model:r.form.model}];});
}});
