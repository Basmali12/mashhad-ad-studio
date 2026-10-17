/* global URL */
import {readGoogleStage} from './google-login.mjs';
const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function normalizeEmail(value){if(typeof value!=='string'||value.length>254||!emailPattern.test(value.trim()))throw Error('Invalid account email');return value.trim().toLowerCase();}
export async function readVerifiedGoogleStage(browser,selection,expectedEmail){
 const state=await readGoogleStage(browser,selection);
 if(state.stage!=='manual')return state;
 const verified=await verifyFlowAccount(browser,expectedEmail,{identityOnly:true});
 if(verified.ready)return {stage:'ready',message:verified.message};
 return {...state,message:verified.message};
}
export async function verifyFlowAccount(browser,expectedEmail,{balanceOnly=false,identityOnly=false}={}){
 if(!expectedEmail)return {ready:false,message:'حدد إيميل حساب Flow الذي تريد ربطه أولًا.'};
 const expected=normalizeEmail(expectedEmail),all=browser.contexts()[0]?.pages()??[],projects=all.filter(p=>{try{const u=new URL(p.url());return u.origin==='https://flow.google.com'&&/^\/(?:u\/[0-9]+\/)?project\/[a-zA-Z0-9-]+$/.test(u.pathname);}catch{return false;}});
 const pages=projects.length?projects:balanceOnly||identityOnly?all.filter(p=>{try{const u=new URL(p.url());return u.origin==='https://flow.google.com'&&/^\/(?:u\/[0-9]+\/)?$/.test(u.pathname);}catch{return false;}}):[];
 if(!pages.length||pages.length>8||(!identityOnly&&!balanceOnly&&pages.length!==1))return {ready:false,message:identityOnly?'أكمل تسجيل Google وانتظر تحميل الصفحة الرئيسية لحساب Flow.':'أكمل تسجيل Google وافتح مشروع Flow واحدًا داخل شاشتك.'};
 // Linking verifies the Google identity, not a generation editor. Several tabs
 // are allowed only when every candidate identifies the same expected account.
 for(const page of pages){const button=page.getByRole('button',{name:/^(تفاصيل الحساب|Account details)$/i});
 try{
  if(await button.count()!==1)return {ready:false,message:'تعذر مطابقة الحساب. افتح شاشة Google وأكمل التحقق.'};
  const rows=page.getByText(emailPattern).filter({visible:true});if(await rows.count()===0)await button.click({timeout:5000});await rows.first().waitFor({timeout:5000});
  const emails=[...new Set((await rows.allTextContents()).map(s=>s.trim().toLowerCase()).filter(s=>emailPattern.test(s)))];
  if(emails.length!==1)return {ready:false,message:'تعذر تحديد حساب Google بشكل واضح. أكمل التحقق داخل الشاشة.'};
  if(emails[0]!==expected)return {ready:false,message:'حساب Google المفتوح يختلف عن الإيميل المحدد. بدّل الحساب داخل شاشة Flow ثم أكد الربط.'};
  if(!balanceOnly&&!identityOnly&&await page.locator('textarea:visible,[contenteditable="true"]:visible').count()!==1)return {ready:false,message:'افتح أدوات الإنشاء داخل مشروع Flow ثم أكد الربط.'};
 }catch{return {ready:false,message:'تعذرت مطابقة الحساب. أكمل تسجيل الدخول والتحقق داخل شاشة Google.'};}
 finally{await page.keyboard.press('Escape').catch(()=>undefined);}
 }
 return {ready:true,email:expected,message:'تمت مطابقة حساب Flow مع الإيميل المحدد.'};
}
