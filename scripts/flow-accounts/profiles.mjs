/* global fetch, AbortSignal, setTimeout */
import {readFile,writeFile,rename} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {submitGoogleField,openGoogleLogin} from './google-login.mjs';
import {normalizeEmail,verifyFlowAccount,readVerifiedGoogleStage} from './flow-session.mjs';
const exec=promisify(execFile),base='/var/lib/mashhad-flow-accounts';
const busy=()=>Object.assign(Error('Account browser occupied'),{code:'BUSY',publicMessage:'شاشة ربط أخرى مشغولة حاليًا. انتظر إغلاقها ثم أعد فتح حسابك؛ حسابات الزبائن منفصلة.'});
export function createProfileManager({workerProfile,launch=startProfile,stop=stopProfile,check=checkProfile,google=googleAction,idleMs=10*60000,readyAt=0,saveEmail=rememberEmail}){
 let active=null,transition=Promise.resolve();const leases=new Map();
 const serial=fn=>{const p=transition.then(fn,fn);transition=p.catch(()=>undefined);return p;};
 const assertActive=p=>{if(!active||active.key!==p.key||active.subject!==p.subject)throw busy();active.seen=Date.now();};
 const open=p=>serial(async()=>{if(Date.now()<readyAt)throw busy();if(!/^[a-f0-9]{24}$/.test(p.key)||typeof p.subject!=='string')throw Error('Invalid profile');if(active){assertActive(p);return;}const profile=await launch(p);active={...p,...profile,seen:Date.now()};});
 const assertViewer=p=>{assertActive(p);if(leases.size)throw busy();};
 return {workerProfile,open,chooseEmail:(p,email)=>serial(async()=>{assertViewer(p);const value=normalizeEmail(email);await saveEmail(active,value);active.expectedGoogleEmail=value;return {email:value};}),assertActive,assertViewer,google:(p,op,input)=>serial(async()=>{assertViewer(p);return google(op,input,active);}),check:p=>serial(async()=>{assertViewer(p);return check(active);}),lock:p=>serial(async()=>{assertActive(p);if(leases.size)return;await stop(active);active=null;}),acquire:async (p,options={})=>{if(p.state!=='ready')throw Object.assign(Error('Login required'),{publicMessage:'أكمل ربط حساب Flow أولًا.'});await open(p);return serial(async()=>{assertViewer(p);const result=await check(active,options);if(!(result===true||result?.ready))throw Object.assign(Error('Account identity not verified'),{publicMessage:result?.message??'أكمل تأكيد حساب Flow الخاص أولًا.'});const lease=randomBytes(32).toString('hex');leases.set(lease,Date.now()+60000);return lease;});},pulse:async lease=>{if((leases.get(lease)??0)<Date.now())throw Error('Expired browser lease');leases.set(lease,Date.now()+60000);},release:async lease=>{leases.delete(lease);},idle:()=>serial(async()=>{for(const [id,until] of leases)if(until<Date.now())leases.delete(id);if(active&&!leases.size&&Date.now()-active.seen>idleMs){await stop(active);active=null;}})};
}
const googleSelections=new Map();
async function googleAction(op,input,profile){
 const {chromium}=await import('/opt/mashhad/node_modules/playwright/index.mjs');
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9433',{timeout:10000});
 const scope=profile.key+':'+profile.subject;let selection=googleSelections.get(scope);if(!selection){selection={};googleSelections.set(scope,selection);}
 try{if(op==='state')return await readVerifiedGoogleStage(browser,selection,profile.expectedGoogleEmail);if(op==='open')return await openGoogleLogin(browser,selection);if(op==='input')return await submitGoogleField(browser,input,selection);throw Error('Unknown login operation');}
 finally{await browser.close();}
}
async function startProfile(p){
 const memory=await readFile('/proc/meminfo','utf8'),available=Number(memory.match(/MemAvailable:\s+(\d+)/)?.[1]??0);if(available<1300*1024)throw Object.assign(Error('Low memory'),{publicMessage:'السيرفر مشغول الآن؛ انتظر قليلًا قبل فتح شاشة حسابك.'});
 const file=base+'/profiles.json';let rows=[];try{rows=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 let slot=rows.find(r=>r.key===p.key);if(slot&&slot.subject!==p.subject)throw Error('Profile owner mismatch');
 if(!slot){if(rows.length>=8)throw Object.assign(Error('Profile capacity'),{publicMessage:'سعة التجربة ممتلئة؛ تواصل مع الإدارة لتوسعة خدمة الحسابات.'});slot={...p,slot:rows.length};rows.push(slot);await writeFile(file+'.tmp',JSON.stringify(rows),{mode:0o600});await rename(file+'.tmp',file);}
 const user='mashhad-f'+slot.slot,home=base+'/'+user;
 // Chrome's saved startup preference can restore every old tab even when
 // launched without a window. Preserve cookies/account data, start with one tab.
 const preferencesPath=home+'/chrome-profile/Default/Preferences';
 let preferences=null;try{preferences=JSON.parse(await readFile(preferencesPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(preferences){preferences.session={...preferences.session,restore_on_startup:5};preferences.profile={...preferences.profile,exit_type:'Normal',exited_cleanly:true};await writeFile(preferencesPath+'.tmp',JSON.stringify(preferences),{mode:0o600});await exec('chown',[user+':'+user,preferencesPath+'.tmp']);await rename(preferencesPath+'.tmp',preferencesPath);}
 const run=(name,args)=>exec('systemd-run',['--quiet','--unit=mashhad-account-'+name,'--property=User='+(name==='novnc'?'mashhad-bridge':user),'--property=UMask=0077','--property=MemoryMax='+(name==='chrome'?'1800M':'140M'),'--property=CPUQuota=60%','--property=NoNewPrivileges=yes','--property=KillMode=control-group','--setenv=HOME='+(name==='novnc'?'/tmp':home),'--setenv=DISPLAY=:101','--setenv=XAUTHORITY='+home+'/.Xauthority',...args],{timeout:20000});
 try{
  await exec('runuser',['-u',user,'--','xauth','-f',home+'/.Xauthority','add',':101','MIT-MAGIC-COOKIE-1',randomBytes(16).toString('hex')]);
  await run('display',['/usr/bin/Xvfb',':101','-screen','0','900x1000x24','-nolisten','tcp','-auth',home+'/.Xauthority']);
  await new Promise(r=>setTimeout(r,500));
  await run('chrome',['/usr/bin/google-chrome-stable','--user-data-dir='+home+'/chrome-profile','--remote-debugging-address=127.0.0.1','--remote-debugging-port=9433','--no-startup-window','--disable-session-crashed-bubble','--no-first-run','--no-default-browser-check','--disable-save-password-bubble','--window-size=900,1000']);
  await run('viewer',['/usr/bin/x11vnc','-display',':101','-auth',home+'/.Xauthority','-localhost','-rfbport','5903','-nopw','-forever','-shared','-quiet']);
  await run('novnc',['/usr/bin/websockify','--web=/usr/share/novnc','127.0.0.1:6082','127.0.0.1:5903']);
  let cdpReady=false;
  for(let n=0;n<30;n++){try{if((await fetch('http://127.0.0.1:9433/json/version',{signal:AbortSignal.timeout(1000)})).ok){cdpReady=true;break;}}catch{/* startup */}await new Promise(r=>setTimeout(r,500));}
  if(!cdpReady)throw Error('Chrome startup failed');
  const {chromium}=await import('/opt/mashhad/node_modules/playwright/index.mjs');
  const browser=await chromium.connectOverCDP('http://127.0.0.1:9433',{timeout:10000});
  try{const page=await browser.contexts()[0].newPage();await page.goto('https://flow.google.com/',{waitUntil:'domcontentloaded',timeout:30000});}finally{await browser.close();}
  return {slot:slot.slot,expectedGoogleEmail:slot.expectedGoogleEmail};
 }catch(e){await stopProfile();throw e;}
}
export async function stopProfile(){await exec('systemctl',['stop','mashhad-account-chrome.service','mashhad-account-novnc.service','mashhad-account-viewer.service','mashhad-account-display.service'],{timeout:45000}).catch(()=>undefined);await exec('systemctl',['reset-failed','mashhad-account-chrome.service','mashhad-account-novnc.service','mashhad-account-viewer.service','mashhad-account-display.service']).catch(()=>undefined);let alive=false;try{alive=(await fetch('http://127.0.0.1:9433/json/version',{signal:AbortSignal.timeout(1000)})).ok;}catch{/* closed */}if(alive)throw Error('Previous private browser still active');}
async function rememberEmail(profile,email){const file=base+'/profiles.json',rows=JSON.parse(await readFile(file,'utf8')),row=rows.find(r=>r.key===profile.key&&r.subject===profile.subject);if(!row)throw Error('Private profile unavailable');row.expectedGoogleEmail=email;await writeFile(file+'.tmp',JSON.stringify(rows),{mode:0o600});await rename(file+'.tmp',file);}
async function checkProfile(profile,options={}){const {chromium}=await import('/opt/mashhad/node_modules/playwright/index.mjs'),b=await chromium.connectOverCDP('http://127.0.0.1:9433',{timeout:10000});try{return await verifyFlowAccount(b,profile.expectedGoogleEmail,{...options,identityOnly:true});}finally{await b.close();}}
