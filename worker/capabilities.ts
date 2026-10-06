import type {Page} from 'playwright';
import {workspace} from './browser';
import {configure,openSettings} from './flow';
import {sleep} from './runtime';
import type {FlowOption} from '../shared/pipeline';
import {flowDurations,preferredFlowDurations} from '../shared/flow-options';
const models:Record<string,string>={'Omni Flash':'Omni 1.1 Flash','Veo 3.1 Fast':'Veo 3.1 - Fast','Veo 3.1 Quality':'Veo 3.1 - Quality'};
// Read settings only. There is deliberately no generation button in this module.
export async function capabilities(page:Page):Promise<FlowOption[]>{
 await workspace(page);const options:FlowOption[]=[];
 for(const [model,label] of Object.entries(models)){
  const control=await openSettings(page);
  await page.getByRole('radio').filter({hasText:'فيديو'}).click();
  await page.getByRole('button',{name:'اختيار فئة النماذج',exact:true}).click();
  const choice=page.getByRole('menuitem').filter({hasText:label});
  if(await choice.count()!==1){await page.keyboard.press('Escape');await page.keyboard.press('Escape');continue;}
  await choice.click();await sleep(250);
  const texts=await page.getByRole('radio').allTextContents(),header=await control.innerText();
  const durations=preferredFlowDurations(model,flowDurations(texts,header));
  const resolutions=(['360p','720p'] as const).filter(r=>texts.some(t=>t.includes(r))||header.includes(r));
  const aspects=['9:16','16:9'].filter(a=>texts.some(t=>t.includes(a)));
  await page.keyboard.press('Escape');
  for(const seconds of durations)for(const resolution of resolutions)for(const aspect of aspects){
   const p=await configure(page,model,aspect,seconds,resolution,1);
   options.push({model,actualModel:p.model,seconds,resolution,aspect,cost:p.cost});
  }
 }
 if(!options.length)throw new Error('OPTIONS_UNKNOWN: لا توجد مدد وكلفة متحققة؛ لا توليد حتى قراءة الخيارات.');
 return options;
}
