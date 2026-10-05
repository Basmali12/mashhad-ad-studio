import type {Page} from 'playwright';
import {parseFlowBalance} from '../shared/flow-balance';
export async function readFlowBalance(current:Page):Promise<{credits?:number;at:number;error?:string}>{
 const page=current;
 try{
  const url=new URL(current.url()),path=url.pathname.match(/^(\/project\/[^/]+)/)?.[1];if(url.hostname!=='flow.google.com'||!path)throw Error('workspace');
  if(url.pathname!==path)await page.goto(url.origin+path,{waitUntil:'domcontentloaded',timeout:20000});
  await page.getByRole('button',{name:/^(تفاصيل الحساب|Account details)$/i}).click({timeout:15000});
  const row=page.getByText(/(?:وحدة من الرصيد في Google Flow|(?:AI\s+)?credits(?:\s+remaining)?)/i).filter({visible:true});
  await row.first().waitFor({timeout:5000});const values=[...new Set((await row.allTextContents()).map(parseFlowBalance).filter((n):n is number=>n!==null))];
  if(values.length!==1)throw Error('ambiguous');return {credits:values[0],at:Date.now()};
 }catch{return {at:Date.now(),error:'تعذرت قراءة رصيد الحساب الرسمي من Flow؛ لا يوجد تقدير بديل.'};}
 finally{const close=page.getByRole('dialog').locator('button').filter({hasText:/^\s*close\s*$/});if(await close.count()===1)await close.click({timeout:2000}).catch(()=>undefined);else await page.keyboard.press('Escape').catch(()=>undefined);}
}
