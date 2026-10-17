import {requestsVideoGeneration} from '../shared/chat-video';
export function requestsCharacterApproval(text:string){const words=text.replace(/[ًٌٍَُِّْـ.!،؟]/g,'');return !/(?:لا|مو|ما|بدون)\s*(?:توافق|موافق|اعتمد|تعتمد|تحفظ|تحفض)/.test(words)&&(/(?:تم الموافقة|موافق|اعتمدها|اعتمده|اعتمد الشخصية|احفظ الشخصية|احفض الشخصية|خزن الشخصية|خزّن الشخصية)/.test(words)||/^(?:نعم|اي|إي|تمام)$/.test(words.trim()));}
export function requestsImageGeneration(text:string){
 if(requestsVideoGeneration(text))return false;
 const words=text.replace(/[ًٌٍَُِّْـ]/g,'');
 if(/(?:لا|بدون|ما)\s*(?:تولد|توليد)/.test(words)||/(?:اكتب|عدل|راجع).*برومبت/.test(words))return false;
 return /(?:ولد|انشئ|أنشئ|ارسم|صمم|سوي|سوّي|اعمل|استخرج)/.test(words)&&/(?:صور|شخصي|وجه|وجوه)/.test(words);
}
export function requestsImageEdit(text:string){
 const words=text.replace(/[ًٌٍَُِّْـ]/g,'');
 if(/^(?:اذا|إذا|لو|هل|شنو|شلون|ليش|كيف)(?:\s|[،؟?]|$)/.test(words.trim())||/^(?:لا|ما|بدون)\s*(?:تغير|تعدل|تعديل|تغيير)/.test(words.trim())||/برومبت/.test(words))return false;
 return /(?:غير|غيّر|عدل|عدّل|بدل|بدّل|شيل|احذف|خلي|ضيف|أضف|اضف|زيد)/.test(words)&&/(?:صور|خلفي|خلفه|لون|الوان|ألوان|ملابس|وجه|اضاء|إضاء|شعر|لحي|سماء|خليها|خليه)/.test(words);
}
export function confirmsImageEdit(text:string){return /^(?:نعم|اي|إي|موافق|تم الموافقة|تمام|صح|ولد|ولّد|نفذ|نفّذ|نعم ولد الصورة|اي ولد|هذا قصدي)(?:[.!،؟\s]*)$/.test(text.trim());}

