import { type Page } from 'playwright';
import {connectFlow} from './chrome-connection';
import { spawn } from 'node:child_process';
import { access,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { root, sleep } from './runtime';
import {platformConfig} from './platform';
import {humanChallenge} from '../shared/flow-human';
const endpoint='http://127.0.0.1:9431';
let connected:Awaited<ReturnType<typeof connectFlow>>|undefined;
export async function browser(){
 try{await fetch(`${endpoint}/json/version`,{signal:AbortSignal.timeout(1500)});}catch{
 if(process.platform==='linux'&&!process.env.DISPLAY)throw new Error('LOGIN_REQUIRED: Linux requires a private graphical display for headed Chrome.');
 const exe=platformConfig().chrome;await access(exe);
 // Standard installed Chrome, headed. No stealth, no sandbox disabling, no cookie import.
 const child=spawn(exe,[`--user-data-dir=${resolve(root,'chrome-profile')}`,'--remote-debugging-address=127.0.0.1','--remote-debugging-port=9431','https://labs.google/fx/tools/flow'],{detached:true,stdio:'ignore',windowsHide:false});child.unref();
 let ready=false;for(let n=0;n<20;n++){await sleep(500);try{const r=await fetch(`${endpoint}/json/version`,{signal:AbortSignal.timeout(1000)});if(r.ok){ready=true;break}}catch{/* Startup */}}
 if(!ready)throw new Error('Close only the dedicated Flow Chrome window, then retry worker:login. Its saved profile stays local.');
 }
 if(connected?.isConnected()&&!connected.contexts()[0]?.pages().length){await connected.close();connected=undefined;}
 const browser=connected?.isConnected()?connected:await connectFlow(endpoint);connected=browser;const context=browser.contexts()[0];if(!context)throw new Error('Chrome context unavailable');
 const pages=context.pages();const page=pages.find(p=>/^https:\/\/(?:flow\.google\.com|labs\.google)\//.test(p.url())&&new URL(p.url()).pathname.includes('/project/'))??pages.find(p=>p.url().startsWith('https://labs.google/')||p.url().startsWith('https://flow.google.com/'))??await context.newPage();
 if(page.url()==='about:blank')await page.goto('https://labs.google/fx/tools/flow');
 return {browser,context,page};
}
export async function workspace(page:Page){
 if(!/^https:\/\/(?:labs\.google\/fx\/tools\/flow|flow\.google\.com)\/project\/[a-zA-Z0-9-]+(?:[/?#]|$)/.test(page.url()))throw new Error('LOGIN_REQUIRED: افتح مشروع Flow حتى تظهر أدوات الفيديو.');
 const possible=page.getByText(/unusual traffic|verify you are human|captcha|تحقق.*بشري|حركة مرور غير معتادة/i);
 for(const n of await possible.all())if(await n.isVisible().catch(()=>false)&&humanChallenge(await n.innerText()))throw new Error('LOGIN_REQUIRED: تحقق بشري؛ أكمله بنفسك.');
 const prompt=page.locator('textarea:visible, [contenteditable="true"]:visible');await prompt.first().waitFor({state:'visible',timeout:15000});
 if(/ينتهك هذا الطلب سياساتنا|prominent people|violates.*polic/i.test(await page.locator('body').innerText()))throw new Error('FLOW_BLOCKED: رفض Flow الطلب بسبب سياسة المحتوى أو صور الشخصيات. راجع المراجع؛ لا إعادة توليد تلقائية.');
 if(await prompt.count()!==1)throw new Error('UI_CHANGED: لا يوجد مربع توليد واحد واضح.');return prompt;
}
export async function inspect(page:Page){await workspace(page);const controls=await page.locator('button:visible, [role="tab"]:visible, [role="menuitem"]:visible, [role="option"]:visible').evaluateAll(nodes=>nodes.map(n=>({role:n.getAttribute('role'),text:(n.textContent??'').trim(),label:n.getAttribute('aria-label'),selected:n.getAttribute('aria-selected')})));return {at:new Date().toISOString(),projectPath:new URL(page.url()).pathname,controls};}
export async function screenshot(page:Page,name:string){if(new URL(page.url()).hostname!=='flow.google.com')return;const session=await page.context().newCDPSession(page);try{const {data}=await session.send('Page.captureScreenshot',{format:'jpeg',quality:85});await writeFile(resolve(root,name),Buffer.from(data,'base64'));}finally{await session.detach();}}
