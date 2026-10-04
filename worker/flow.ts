import type { Page, BrowserContext } from 'playwright';
import { workspace,screenshot } from './browser';
import { persist, sleep } from './runtime';
import { writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
export interface Plan{model:string;aspect:string;seconds:number;resolution:'360p'|'720p';outputs:number;cost:number;projectPath:string}
export interface Asset{id:string;url:string;duration:number;width:number;height:number}
const labels:Record<string,string>={'Omni Flash':'Omni 1.1 Flash','Veo 3.1 Fast':'Veo 3.1 - Fast','Veo 3.1 Quality':'Veo 3.1 - Quality'};
export async function openSettings(page:Page){await workspace(page);const control=page.getByRole('button',{name:'مشغِّل الإعدادات',exact:true});if(await control.count()!==1)throw new Error('UI_CHANGED: اختر وضع الإنشاء المباشر.');const video=page.getByRole('radio').filter({hasText:'فيديو'});if(!await video.isVisible()){await control.click();await sleep(500);if(!await video.isVisible())await control.press('Space');}await video.waitFor({state:'visible',timeout:8000});return control;}
async function radio(page:Page,text:string){const choice=page.getByRole('radio').filter({hasText:text});if(await choice.count()!==1||!await choice.isEnabled())throw new Error(`UNSUPPORTED: ${text}`);await choice.click();for(let n=0;n<15;n++){if(await choice.getAttribute('aria-checked')==='true')return;await sleep(100);}throw new Error(`UI_CHANGED: ${text} not selected`);}
export async function configure(page:Page,model:string,aspect:string,seconds:number,resolution:'360p'|'720p',outputs:number,mode:'ingredients'|'frames'='ingredients'):Promise<Plan>{
 await page.bringToFront();await workspace(page);
 if(new URL(page.url()).pathname.includes('/edit/'))throw new Error('UI_CHANGED: افتح مساحة مشروع الإنشاء، وليس محرر فيديو موجود.');
 const control=await openSettings(page);await radio(page,'فيديو');await radio(page,mode==='frames'?'الإطارات':'المكوّنات');await sleep(300);
 await page.getByRole('button',{name:'اختيار فئة النماذج',exact:true}).click();const label=labels[model];if(!label)throw new Error('UNSUPPORTED: model');const choice=page.getByRole('menuitem').filter({hasText:label});if(await choice.count()!==1)throw new Error(`UNSUPPORTED: ${model}`);await choice.click();
 await radio(page,aspect);await radio(page,`x${outputs}`);
 for(const setting of [resolution,`${seconds}ث`]){const option=page.getByRole('radio').filter({hasText:setting});if(await option.count()===1)await radio(page,setting);else if(!(await control.innerText()).includes(setting))throw new Error(`UNSUPPORTED: ${setting} is not available or the fixed model default differs.`);}
 const text=await page.locator('body').innerText();const match=text.match(/ستستهلك عملية الإنشاء\s+([0-9]+)\s+من الوحدات/);if(!match)throw new Error('COST_UNKNOWN: لم تظهر كلفة مؤكدة قبل الإنشاء؛ توقف للفحص.');
 const plan={model:label,aspect,seconds,resolution,outputs,cost:Number(match[1]),projectPath:new URL(page.url()).pathname};
 await persist('last-options.json',plan);await screenshot(page,'options-before-generation.jpg');
 await page.keyboard.press('Escape');return plan;
}
export async function startFrame(page:Page,file:string){
 const start=page.getByRole('button',{name:'بدء',exact:true});
 if(await start.count()!==1||await page.getByRole('button',{name:'مكوّن الصورة',exact:true}).count())throw new Error('CONTINUATION_UNSUPPORTED: إطار بداية فارغ غير متاح.');
 await start.click();const upload=page.getByRole('button').filter({hasText:'تحميل وسائط'});await upload.waitFor({timeout:10000});
 const waiting=page.waitForEvent('filechooser',{timeout:10000});await upload.click();await(await waiting).setFiles(file);
 const item=page.getByRole('option').filter({hasText:basename(file)});await item.waitFor({timeout:60000});
 const deadline=Date.now()+60000;while((await item.innerText()).includes('جارٍ التحميل')&&Date.now()<deadline)await sleep(500);
 if((await item.innerText()).includes('جارٍ التحميل'))throw new Error('FRAME_UPLOAD_FAILED: لم يكتمل رفع إطار البداية.');
 await item.click();const chip=page.getByRole('button',{name:'مكوّن الصورة',exact:true});
 for(let n=0;n<50;n++){if(await chip.count()===1&&await chip.getAttribute('aria-busy')==='false')break;await sleep(100);}
 // Current Flow selects and closes automatically; older UI requires explicit Add.
 if(await start.count()){const add=page.getByRole('button',{name:'الإضافة إلى الطلب',exact:true});if(await add.count()===1&&await add.isVisible()&&await add.isEnabled())await add.click();}
 await chip.waitFor({timeout:10000});
 if(await chip.count()!==1||await start.count()||await chip.getAttribute('aria-busy')!=='false'||await page.getByRole('button',{name:'إنهاء',exact:true}).count()!==1)throw new Error('FRAME_IDENTITY_AMBIGUOUS: لم يُثبت إطار البداية وحده؛ لا توليد.');
 await screenshot(page,'continuation-start-frame.jpg');
}
export async function media(page:Page):Promise<Asset[]>{return page.locator('video').evaluateAll(nodes=>nodes.flatMap(node=>{
 const video=node as HTMLVideoElement;let id='';for(let el:Element|null=video,depth=0;el&&depth<8;el=el.parentElement,depth++){id=el.getAttribute('data-asset-id')??el.getAttribute('data-media-id')??el.getAttribute('data-generation-id')??'';if(id)break;}
 const url=video.currentSrc||video.src; // Stable UUID in a URL is acceptable; never use gallery position or signed URL as job ID.
 if(!id){const match=url.match(/(?:media|asset|generation)[/=:]([a-zA-Z0-9-]{16,})/);if(match)id=match[1];}
 return id&&url&&Number.isFinite(video.duration)&&video.duration>0?[{id,url,duration:video.duration,width:video.videoWidth,height:video.videoHeight}]:[];
}));}
export async function attachments(page:Page,files:string[]){if(!files.length)return;
 // Verified current Flow upload chooser + selection. Uploading references never clicks Generate.
 const chips=page.getByRole('button',{name:'المكوّن',exact:true});const initial=await chips.count();
 for(const [index,file] of files.entries()){await page.getByRole('button',{name:'إضافة المكوّنات إلى مربّع الطلب',exact:true}).click();const upload=page.getByRole('button').filter({hasText:'تحميل وسائط'});await upload.waitFor({state:'visible',timeout:10000});if(await upload.count()!==1)throw new Error('UNSUPPORTED: رفع المراجع غير ظاهر في هذا الوضع.');
 const waiting=page.waitForEvent('filechooser',{timeout:10000});await upload.click();const chooser=await waiting;await chooser.setFiles(file);
 const item=page.getByRole('option').filter({hasText:basename(file)});await item.waitFor({timeout:60000});
 const deadline=Date.now()+60000;while((await item.innerText()).includes('جارٍ التحميل')&&Date.now()<deadline)await sleep(500);
 if((await item.innerText()).includes('جارٍ التحميل')||await item.count()!==1)throw new Error('REFERENCE_UPLOAD_FAILED: لم يكتمل رفع المرجع.');
 await item.click();
 // Current Flow attaches a single selected ingredient immediately and closes the chooser.
 for(let n=0;n<50;n++){if(await chips.count()>initial+index||await item.getAttribute('aria-selected').catch(()=>null)==='true')break;await sleep(100);}
 if(await chips.count()<=initial+index){if(await item.getAttribute('aria-selected').catch(()=>null)!=='true')throw new Error('REFERENCE_UNSUPPORTED: لم يُحدد المرجع.');const add=page.getByRole('button',{name:'الإضافة إلى الطلب',exact:true});if(!await add.isEnabled())throw new Error('REFERENCE_UNSUPPORTED: هذا الوضع لم يقبل المراجع.');await add.click();}
 await chips.nth(initial+index).waitFor({state:'visible',timeout:10000});
 }
 if(await chips.count()<initial+files.length)throw new Error('REFERENCE_UNSUPPORTED: تحقق من المراجع المرفقة قبل إرسال الطلب.');
}
export async function waitAssets(page:Page,ids:string[],baseline:string[],count:number,signal:()=>boolean,expectedPrompt:string):Promise<Asset[]>{
 const deadline=Date.now()+15*60*1000;
 while(Date.now()<deadline){if(signal())throw new Error('STOPPED: متابعة محفوظة؛ لم تُعد عملية التوليد.');await workspace(page);
 const body=(await page.locator('body').innerText()).slice(-12000);if(/تعذّر الإنشاء|فشل الإنشاء|غير متاحة.*بلد|وحدات غير كافية|generation failed|unusual traffic/i.test(body))throw new Error('FLOW_BLOCKED: توقف Flow؛ لا إعادة توليد تلقائية.');
 const all=await media(page);const result=ids.length?all.filter(a=>ids.includes(a.id)):all.filter(a=>!baseline.includes(a.id));
 const editor=new URL(page.url()).pathname.match(/\/project\/([a-f0-9-]+)\/edit\/([a-f0-9-]+)$/);
 if(editor){const marker=expectedPrompt.match(/معرّف المشهد:\s*[a-zA-Z0-9-]+/)?.[0];if(count!==1||(ids.length&&!ids.includes(editor[2]))||(!ids.length&&!body.includes(expectedPrompt.trim())&&!(marker&&body.includes(marker))))throw new Error('IDENTITY_AMBIGUOUS: محرر الفيديو لا يطابق الطلب المحفوظ.');const downloadControl=page.getByRole('button',{name:'تنزيل الوسائط',exact:true});if(await downloadControl.count()===1&&await downloadControl.isEnabled())return [{id:editor[2],url:'',duration:0,width:0,height:0}];await sleep(2000);continue;}
 const tiles=page.locator('flow-video-tile');
 if(!ids.length&&!baseline.length&&count===1&&await tiles.count()===1&&await tiles.getByText('play_circle',{exact:true}).count()>0){await tiles.click();await sleep(1000);continue;}
 // Fresh empty dedicated project + baseline + one submit are required; no arbitrary gallery fallback.
 if(result.length===count)return result;if(result.length>count)throw new Error('IDENTITY_AMBIGUOUS: أكثر من نتيجة جديدة؛ لا اختيار عشوائي.');await sleep(2000);
 }
 throw new Error('FOLLOW_UP_REQUIRED: انتهت مهلة المتابعة؛ شغّل resume، دون إرسال جديد.');
}
export async function download(context:BrowserContext,asset:Asset,destination:string,page:Page){
 if(!asset.url){const path=new URL(page.url()).pathname;if(!path.endsWith(`/edit/${asset.id}`))throw new Error('IDENTITY_AMBIGUOUS: wrong download target');
 const original=page.getByRole('menuitem').filter({hasText:'الحجم الأصلي'});
 if(!await original.isVisible())await page.getByRole('button',{name:'تنزيل الوسائط',exact:true}).click();
 await original.waitFor({timeout:10000});if(await original.count()!==1)throw new Error('DOWNLOAD_UNSUPPORTED: Original only; no upscale.');
 const waiting=page.waitForEvent('download',{timeout:120000});await original.click();const file=await waiting;if(await file.failure())throw new Error('DOWNLOAD_FAILED: original file');await file.saveAs(destination);return;}
 const url=new URL(asset.url);if(url.protocol!=='https:'||!['googleusercontent.com','googlevideo.com','googleapis.com','google.com'].some(host=>url.hostname===host||url.hostname.endsWith(`.${host}`)))throw new Error('DOWNLOAD_UNSUPPORTED: مصدر الفيديو ليس HTTPS معروفًا؛ لا تنزيل بديل.');
 const response=await context.request.get(asset.url,{timeout:120000});try{if(!response.ok()||!response.headers()['content-type']?.startsWith('video/'))throw new Error('DOWNLOAD_FAILED: لم يُرجع Flow فيديو.');const bytes=await response.body();if(bytes.length===0)throw new Error('EMPTY_VIDEO');await writeFile(destination,bytes);}finally{await response.dispose();}
}
