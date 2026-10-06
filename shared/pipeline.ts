import {voiceDirection} from './iraqi-dialect';
import type {AdForm} from '../src/data';
import type {EditSettings} from './editing';
export interface FlowOption {model:string;actualModel:string;seconds:number;resolution:'360p'|'720p';aspect:string;cost:number}
export const pipelineStages={queued:'بانتظار التشغيل',generating:'التوليد',downloading:'التنزيل',montage:'المونتاج',uploading:'الرفع',completed:'مكتمل',failed:'فشل',stopped:'متوقف',login:'يحتاج تسجيل دخول',uncertain:'النتيجة غير محسومة'} as const;
export const clipStages={pending:'بانتظار التوليد',intent:'ثُبتت نية الإرسال',submitted:'أُرسل؛ بانتظار النتيجة',unknown:'إرسال غير محسوم؛ متابعة الأصل فقط',downloaded:'نُزّل محليًا',uploaded:'حُفظ المقطع',failed:'فشل'} as const;
export type Template=Omit<EditSettings,'clips'|'duration'|'transition'>;
export function defaultTemplate(form:AdForm,logo=false):Template{return {aspect:form.aspect as '9:16'|'16:9',fit:'contain',width:720,logo:{enabled:logo,position:'top-right',size:18,start:0,end:form.duration},text:{name:true,address:true,phone:true,position:'bottom',color:'#ffffff',background:'#171523'}};}
export function clipPrompts(form:AdForm,count:number){
 const prompts=[form.prompt,...(form.continuationPrompts??[]).slice(0,count-1)];
 if(prompts.length!==count||prompts.some(p=>!p.trim()||p.length>10000))throw new Error('اكتب برومبت مستقلًا لكل مقطع تكملة.');
 if(new Set(prompts.map(p=>p.trim())).size!==count)throw new Error('برومبت التكملة يجب أن يختلف عن المقاطع السابقة.');
 return prompts.map((prompt,i)=>`${prompt.trim()}\n${form.instructions}\n${form.placeImageGuide??''}\nالمنتجات والعروض: ${form.products}\nالمقطع ${i+1} من ${count}، مدته ${form.duration/count} ثانية فقط. ${(i||form.continuationSourceId)?'ابدأ من إطار البداية المرفق، وهو آخر إطار للمقطع السابق. أكمل حركة الكاميرا والحدث، مع الحفاظ على الشخصية والملابس والمكان والإضاءة. لا تعِد افتتاح الإعلان.':'هذا افتتاح الإعلان.'}\nاللهجة عند وجود كلام: ${form.dialect}\n${voiceDirection(form.dialect)}\nلا تضف شعارًا أو نصوصًا؛ ستضاف في المونتاج.`);
}
export function checkPlan(option:FlowOption,count:number,duration:number){if(!Number.isSafeInteger(count)||count<1||count>20||!Number.isFinite(option.seconds)||option.seconds<1||option.seconds>30||Math.abs(duration-option.seconds*count)>.001||duration>180||!Number.isFinite(option.cost)||option.cost<0)throw new Error('خطة المقاطع غير صالحة؛ المدة تساوي مدة الوحدة المدعومة × عدد المقاطع.');}
