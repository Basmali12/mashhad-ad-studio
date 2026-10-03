import { v } from 'convex/values';
export const formValidator = v.object({name:v.string(),address:v.string(),phone:v.string(),products:v.string(),prompt:v.string(),instructions:v.string(),model:v.string(),aspect:v.string(),duration:v.number(),dialect:v.string()});
export const statusValidator = v.union(v.literal('مسودة'),v.literal('بانتظار التشغيل'),v.literal('قيد التوليد'),v.literal('قيد التنزيل'),v.literal('قيد المونتاج'),v.literal('قيد الرفع'),v.literal('متوقف'),v.literal('النتيجة غير محسومة'),v.literal('مكتمل'),v.literal('فشل'),v.literal('يحتاج تسجيل دخول'));
export const kindValidator = v.union(v.literal('image'),v.literal('video'));
