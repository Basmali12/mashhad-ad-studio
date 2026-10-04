import {v} from 'convex/values';
import {editValidator} from './editValidators';
export const optionValidator=v.object({model:v.string(),actualModel:v.string(),seconds:v.number(),resolution:v.union(v.literal('360p'),v.literal('720p')),aspect:v.string(),cost:v.number()});
export const templateValidator=v.object({aspect:v.optional(v.union(v.literal('9:16'),v.literal('16:9'))),fit:editValidator.fields.fit,width:editValidator.fields.width,logo:editValidator.fields.logo,text:editValidator.fields.text});
export const stageValidator=v.union(...(['queued','generating','downloading','montage','uploading','completed','failed','stopped','login','uncertain'] as const).map(s=>v.literal(s)));
export const clipStateValidator=v.union(...(['pending','intent','submitted','unknown','downloaded','uploaded','failed'] as const).map(s=>v.literal(s)));
export const clipValidator=v.object({index:v.number(),percent:v.optional(v.number()),prompt:v.string(),state:clipStateValidator,projectPath:v.optional(v.string()),assetId:v.optional(v.string()),storageId:v.optional(v.id('_storage')),duration:v.optional(v.number()),width:v.optional(v.number()),height:v.optional(v.number()),error:v.optional(v.string()),submittedAt:v.optional(v.number())});
