import {ConvexError} from 'convex/values';
export function isolatedPublishing(){try{return new URL(process.env.CONVEX_SITE_URL??'').hostname==='127.0.0.1';}catch{return false;}}
export function publishingCutover(){const value=Number(process.env.REELS_LIVE_START_AT);return Number.isSafeInteger(value)&&value>0?value:null;}
function customerCutover(){const value=Number(process.env.REELS_CUSTOMER_LIVE_START_AT);return Number.isSafeInteger(value)&&value>0?value:null;}
export function customerPersonalEnabled(){return /^https:\/\/[a-z0-9-]+\.convex\.site$/.test(process.env.CONVEX_SITE_URL??'')&&process.env.PUBLISHING_SAAS_ENABLED==='true'&&process.env.REELS_CUSTOMER_PERSONAL_ENABLED==='true'&&customerCutover()!==null;}
// Channel, subscription and binding ownership are rechecked by guardChannels before every send.
export function personalPublishingAllowed(subject:string,accountId:string){
 if(isolatedPublishing())return true;
 if(!/^https:\/\/[a-z0-9-]+\.convex\.site$/.test(process.env.CONVEX_SITE_URL??''))return false;
 if(!subject||!accountId||!process.env.OWNER_SUBJECT)return false;
 if(subject===process.env.OWNER_SUBJECT)return process.env.REELS_OWNER_PERSONAL_ENABLED==='true'&&!!process.env.REELS_OWNER_BUFFER_ACCOUNT_ID&&accountId===process.env.REELS_OWNER_BUFFER_ACCOUNT_ID&&publishingCutover()!==null;
 return customerPersonalEnabled()&&accountId!==process.env.REELS_OWNER_BUFFER_ACCOUNT_ID;
}
export function assertJobPublishing(job:{subject:string;authMode:'personal'|'oauth';createdAt:number;dueAt:number},accountId:string){
 if(process.env.PUBLISHING_REAL_SEND_ENABLED!=='true')throw new ConvexError('الإرسال الحقيقي غير مفعّل.');
 if(job.authMode==='personal'&&!personalPublishingAllowed(job.subject,accountId))throw new ConvexError('النشر بالمفتاح الشخصي غير معتمد لهذا الحساب.');
 if(!isolatedPublishing()){
  const start=job.subject===process.env.OWNER_SUBJECT?publishingCutover():customerCutover();if(start===null||job.createdAt<start||job.dueAt<start)throw new ConvexError('مهمة سابقة للتفعيل؛ لا تُرسل بأثر رجعي.');
  if(job.subject!==process.env.OWNER_SUBJECT&&job.authMode!=='personal')throw new ConvexError('نشر الزبائن يتطلب مفتاح Buffer الشخصي المعتمد.');
  if(process.env.PUBLISHING_SAAS_ENABLED!=='true'&&job.subject!==process.env.OWNER_SUBJECT)throw new ConvexError('النشر التجاري للزبائن غير مفعّل.');
 }
}
