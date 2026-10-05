import {v} from 'convex/values';
export const filmSettings=v.object({style:v.string(),dialect:v.string(),episodes:v.number(),seconds:v.number()});
export const filmPlan=v.object({title:v.string(),synopsis:v.string(),ending:v.string(),scenes:v.array(v.object({seconds:v.number(),description:v.string(),dialogue:v.string(),cast:v.array(v.string()),place:v.string(),continuity:v.string()}))});
