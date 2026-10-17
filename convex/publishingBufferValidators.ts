import {v} from 'convex/values';
export const publishingBufferChannel=v.object({id:v.string(),name:v.string(),avatar:v.optional(v.string()),service:v.string(),organizationId:v.string(),type:v.string(),isDisconnected:v.boolean(),isLocked:v.boolean()});
export const publishingBufferLimit=v.object({policy:v.string(),remaining:v.number(),resetSeconds:v.number()});
