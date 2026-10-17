/* global URL,location,document,HTMLInputElement,Event */
// Only the authenticated customer's desktop may call these helpers.
// Never return field values, Google account details, passwords, or raw browser errors.
const manual={stage:'manual',message:'أكمل هذه الخطوة داخل شاشة Google الأصلية، ثم اضغط تحديث حالة الدخول.'};
async function targetId(page){const session=await page.context().newCDPSession(page);try{return (await session.send('Target.getTargetInfo')).targetInfo.targetId;}finally{await session.detach();}}
const googlePage=async (browser,selection={})=>{
 const pages=browser.contexts()[0]?.pages()??[];
 const matching=pages.filter(page=>{try{const u=new URL(page.url());return u.protocol==='https:'&&u.hostname==='accounts.google.com'&&!u.username&&!u.password;}catch{return false;}});
 if(selection.targetId){for(const page of matching)if(await targetId(page)===selection.targetId)return page;return null;}
 return matching.length===1?matching[0]:null;
};
export async function readGoogleStage(browser,selection={}){
 const page=await googlePage(browser,selection);
 if(!page)return manual;
 // Unsupported account choosers, verification challenges, and recovery flows stay manual.
 const path=new URL(page.url()).pathname;
 if(!/\/(?:v3\/signin\/identifier|signin\/v2\/identifier|signin\/identifier|ServiceLogin)$/.test(path)&&!/^\/(?:v3\/signin|signin\/v2)\/challenge\/pwd$/.test(path))return manual;
 const email=page.locator('input#identifierId:visible'),password=page.locator('input[name="Passwd"][type="password"]:visible');
 if(await email.count()===1&&await password.count()===0)return {stage:'email',message:'اكتب إيميل Google المرتبط بحساب Flow.'};
 if(await password.count()===1&&await email.count()===0)return {stage:'password',message:'اكتب كلمة سر Google لإكمال الدخول إلى جلسة Flow الخاصة بك.'};
 return manual;
}
export async function submitGoogleField(browser,{stage,value},selection={}){
 if(!['email','password'].includes(stage)||typeof value!=='string'||!value.length||value.length>1024)throw Error('Invalid login field');
 const current=await readGoogleStage(browser,selection);
 if(current.stage!==stage)throw Error('Google login step changed');
 const page=await googlePage(browser,selection);
 const next=page.locator(stage==='email'?'#identifierNext button:visible':'#passwordNext button:visible');
 if(await next.count()!==1)throw Error('Google requires manual interaction');
 // Validate the origin and write in one browser task, so navigation cannot move
 // the credential write to a different site's document between async calls.
 const written=await page.evaluate(({stage,value})=>{
  if(location.origin!=='https://accounts.google.com')return false;
  const allowed=stage==='email'?/\/(?:v3\/signin\/identifier|signin\/v2\/identifier|signin\/identifier|ServiceLogin)$/:/^\/(?:v3\/signin|signin\/v2)\/challenge\/pwd$/;
  if(!allowed.test(location.pathname))return false;
  const selector=stage==='email'?'input#identifierId':'input[name="Passwd"][type="password"]';
  const fields=[...document.querySelectorAll(selector)].filter(field=>field.getClientRects().length&&!field.disabled&&!field.readOnly);
  if(fields.length!==1)return false;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(fields[0],value);
  fields[0].dispatchEvent(new Event('input',{bubbles:true}));fields[0].dispatchEvent(new Event('change',{bubbles:true}));
  return true;
 },{stage,value});
 if(!written)throw Error('Login page changed');
 // Recheck the origin after filling and before submitting; never forward to another site.
 if(await googlePage(browser,selection)!==page||new URL(page.url()).hostname!=='accounts.google.com')throw Error('Login page changed');
 await next.click({timeout:5000});
 return {ok:true,message:'تم إرسال الحقل إلى Google. حدّث حالة الدخول لإكمال الخطوة التالية.'};
}
export async function openGoogleLogin(browser,selection={}){
 const existing=await googlePage(browser,selection);
 if(selection.targetId&&existing)return readGoogleStage(browser,selection);
 const context=browser.contexts()[0];if(!context)return manual;
 // Explicitly create one designated sign-in tab; never choose among unrelated tabs.
 const page=await context.newPage();selection.targetId=await targetId(page);
 await page.goto('https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fflow.google.com%2F',{waitUntil:'domcontentloaded',timeout:30000});
 return readGoogleStage(browser,selection);
}
