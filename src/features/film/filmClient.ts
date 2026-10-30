/* eslint-disable @typescript-eslint/no-explicit-any -- preserved film DTO renderer; server boundary validates and redacts every operation. */
import type {FilmOperation} from '../../../shared/film-contracts';
export type FilmRequest = (operation:FilmOperation,input?:Record<string,unknown>,requestId?:string)=>Promise<any>;
export const unavailable='خدمة صناعة الأفلام غير متاحة حالياً. لم يبدأ تشغيل جديد. تابع أي جلسة قائمة عند عودة الخدمة.';
export function isFailure(value:any){return !!value && typeof value.error==='string' && !value.id && typeof value.message==='string';}
export function usd(micros:number|null|undefined){return micros==null?'غير معروف':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:6}).format(micros/1e6);}
export function dateBaghdad(value:number|null|undefined){return value?new Intl.DateTimeFormat('ar-IQ',{timeZone:'Asia/Baghdad',dateStyle:'medium',timeStyle:'short'}).format(value):'غير محدد';}
export const states:Record<string,string>={locked:'مقفل',busy:'مشغول',available:'متاح للحجز',reserved:'محجوز',preparing:'جارٍ التجهيز',ready:'جاهز',stopping:'جارٍ الإيقاف؛ بانتظار التحقق',uncertain:'حالة غير محسومة؛ متابعة فقط',closed:'تم التحقق من الإيقاف',draft:'مسودة',planned:'التقرير جاهز للمراجعة',generating:'جارٍ إنتاج المشاهد',needs_review:'متوقف',completed:'مكتمل',pending:'بانتظار البدء',submitted:'قيد التنفيذ',done:'مكتمل',running:'قيد التنفيذ',unavailable:'غير متاح',failed:'تعذر الإكمال'};
export const stateLabel=(value:string)=>states[value]??'متابعة الحالة';
