import type {Page} from 'playwright';
export const personalOwnerEmail='basm1998ali@gmail.com';
export async function assertOwnerFlowAccount(page:Page){
 const rows=page.getByText(/^[^\s@]+@[^\s@]+\.[^\s@]+$/).filter({visible:true});
 try{
  if(await rows.count()===0)await page.getByRole('button',{name:/^(تفاصيل الحساب|Account details)$/i}).click({timeout:5000});
  await rows.first().waitFor({state:'visible',timeout:5000});
  const emails=[...new Set((await rows.allTextContents()).map(v=>v.trim().toLowerCase()))];
  if(emails.length!==1||emails[0]!==personalOwnerEmail)throw Error('mismatch');
 }catch{throw new Error(`LOGIN_REQUIRED: حساب Flow المفتوح لا يطابق ${personalOwnerEmail}. سجّل حسابك الشخصي داخل شاشة Flow؛ التوليد متوقف.`);}
 finally{await page.keyboard.press('Escape').catch(()=>undefined);}
}
