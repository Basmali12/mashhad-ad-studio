import type {Page} from 'playwright';
import {parseFlowBalance} from '../shared/flow-balance';
export async function readFlowBalance(current:Page):Promise<{credits?:number;at:number;error?:string}>{
 const page=current;
 try{
  const url=new URL(current.url()),path=url.pathname.match(/^(\/(?:u\/[0-9]+\/)?project\/[^/]+)/)?.[1];if(url.hostname!=='flow.google.com'||(!path&&!/^\/(?:u\/[0-9]+\/)?$/.test(url.pathname)))throw Error('workspace');
  // Flow keeps its account-menu credits cached after another tab generates media.
  if(path&&url.pathname!==path)await page.goto(url.origin+path,{waitUntil:'domcontentloaded',timeout:20000});
  else await page.reload({waitUntil:'domcontentloaded',timeout:20000});
  const row=page.getByText(/(?:وحدة من الرصيد في Google Flow|(?:AI\s+)?credits(?:\s+remaining)?)/i).filter({visible:true});
  if(await row.count()===0)await page.getByRole('button',{name:/^(تفاصيل الحساب|Account details)$/i}).click({timeout:15000});
  await row.first().waitFor({timeout:5000});const values=[...new Set((await row.allTextContents()).map(parseFlowBalance).filter((n):n is number=>n!==null))];
  if(values.length!==1)throw Error('ambiguous');return {credits:values[0],at:Date.now()};
 }catch{return {at:Date.now(),error:'تعذرت قراءة رصيد الحساب الرسمي من Flow؛ لا يوجد تقدير بديل.'};}
 finally{const close=page.getByRole('dialog').locator('button').filter({hasText:/^\s*close\s*$/});if(await close.count()===1)await close.click({timeout:2000}).catch(()=>undefined);else await page.keyboard.press('Escape').catch(()=>undefined);}
}
