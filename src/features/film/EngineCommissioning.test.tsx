import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import EngineCommissioning,{EngineTestQuoteReview,EngineTestResult,executeEngineTest,prepareModelTestQuote,mayApprove,mayPublish,mayReview,type CommissioningState,type EngineTestQuote} from './EngineCommissioning';
const noop=()=>{};
const artifact={id:'image-one',kind:'image',sha256:'a'.repeat(64)};
const state:CommissioningState={engineId:'engine-one',workflowState:'needs_review',testCurrent:true,filesReady:true,environmentReady:true,license:{allowed:true,blockers:[]},latestTest:{id:'test-one',status:'needs_review',cloudStopped:true,progress:null,artifacts:[artifact],estimatedMicroUSD:50000,recordedProviderUSD:null},approval:null,publication:null};
const quote:EngineTestQuote={id:'quote-one',engineId:'engine-one',estimatedMicroUSD:50000,dispatchAvailable:true,blockers:[],expiresAt:Date.now()+60000};
const props={busy:false,onReview:noop,onApprove:noop,onPublish:noop,onUnpublish:noop,onView:noop};
it('opening commissioning UI never dispatches preparation or inference',()=>{
 let calls=0;const html=renderToStaticMarkup(<EngineCommissioning request={async()=>{calls++;throw Error('NO_CLOUD');}} engineId="engine-one" modelId="flux2-klein-4b" onChanged={async()=>{}}/>);
 expect(calls).toBe(0);expect(html).toContain('الاختبار والاعتماد والنشر');expect(html).toContain('وصف صورة الاختبار');expect(html).toContain('أفقي 16:9');expect(html).not.toContain('Token Secret');expect(html).not.toContain('اختبار ناجح');
});
it('non-FLUX tests require a real owned project stage and cannot invent a reference',()=>{
 const html=renderToStaticMarkup(<EngineCommissioning request={async()=>{throw Error('NO_CLOUD');}} engineId="engine-two" modelId="habibi-irq" onChanged={async()=>{}}/>);
 expect(html).toContain('معرّف مشروع الاختبار');expect(html).toContain('معرّف المرحلة');expect(html).toContain('صوره وأصواته المعتمدة');expect(html).not.toContain('وصف صورة الاختبار');
});
it('file and environment readiness alone never approve or publish a model',()=>{
 expect(mayApprove(state)).toBe(false);expect(mayPublish(state)).toBe(false);expect(mayReview(state.latestTest)).toBe(true);
 const html=renderToStaticMarkup(<EngineTestResult status={state} {...props}/>);expect(html).toContain('الملفات: جاهزة');expect(html).toContain('نتيجة الاختبار تحتاج مراجعة');expect(html).toContain('معاينة نتيجة الصورة');expect(html).toContain('راجعت النتيجة — قبول');expect(html).toMatch(/disabled=""[^>]*>اعتماد المحرك/);expect(html).toMatch(/disabled=""[^>]*>نشر للزبائن/);expect(html).toContain('كلفة المورد المسجلة: غير متاحة');
});
it('unresolved resource stop prevents review even if an artifact exists',()=>{
 expect(mayReview({...state.latestTest!,cloudStopped:false})).toBe(false);expect(mayApprove({...state,latestTest:{...state.latestTest!,status:'passed',accepted:true,cloudStopped:false}})).toBe(false);
 const html=renderToStaticMarkup(<EngineTestResult status={{...state,latestTest:{...state.latestTest!,cloudStopped:false}}} {...props}/>);expect(html).toContain('بانتظار تأكيد توقف الموارد');expect(html).not.toContain('راجعت النتيجة — قبول');
});
it('failed and rejected tests cannot be approved or published',()=>{
 for(const status of ['failed','uncertain','cancelled','running']){const value={...state,latestTest:{...state.latestTest!,status,accepted:false}};expect(mayApprove(value)).toBe(false);expect(mayPublish(value)).toBe(false);}
});
it('licence restriction blocks administrative approval despite successful reviewed output',()=>{
 const value={...state,license:{allowed:false,blockers:['LATENTSYNC_FACE_RIGHTS_REQUIRED']},latestTest:{...state.latestTest!,status:'passed',accepted:true}};
 expect(mayApprove(value)).toBe(false);expect(mayPublish({...value,approval:{approved:true,testId:'test-one'}})).toBe(false);
 const html=renderToStaticMarkup(<EngineTestResult status={value} {...props}/>);expect(html).toContain('ترخيص الاستخدام المطلوب غير معتمد');expect(html).toMatch(/disabled=""[^>]*>اعتماد المحرك/);
});
it('reviewed success and current matching approval are separate from publication',()=>{
 const passed={...state,workflowState:'test_passed',latestTest:{...state.latestTest!,status:'passed',accepted:true,reviewed:true}};
 expect(mayApprove(passed)).toBe(true);expect(mayPublish(passed)).toBe(false);expect(mayPublish({...passed,approval:{approved:true,testId:'old-test'}})).toBe(false);expect(mayPublish({...passed,approval:{approved:true,testId:'test-one'}})).toBe(true);expect(mayPublish({...passed,approval:{approved:true,testId:'test-one'},publication:{published:true}})).toBe(false);
 const html=renderToStaticMarkup(<EngineTestResult status={{...passed,approval:{approved:true,testId:'test-one'}}} {...props}/>);expect(html).toContain('نشر للزبائن');expect(html).not.toContain('<video');expect(html).not.toContain('<img');
});
it('test evidence for a previous settings revision cannot unlock review or publication',()=>{
 const old={...state,testCurrent:false,latestTest:{...state.latestTest!,status:'passed',accepted:true},approval:{approved:true,testId:'test-one'}};expect(mayApprove(old)).toBe(false);expect(mayPublish(old)).toBe(false);
 const html=renderToStaticMarkup(<EngineTestResult status={{...state,testCurrent:false}} {...props}/>);expect(html).not.toContain('راجعت النتيجة — قبول');expect(html).toMatch(/disabled=""[^>]*>اعتماد المحرك/);
});
it('real test counters are displayed without guessed percentages or ETA',()=>{
 const value={...state,latestTest:{...state.latestTest!,status:'running',cloudStopped:false,progress:{completed:2,total:12,unit:'steps'}}};
 const html=renderToStaticMarkup(<EngineTestResult status={value} {...props}/>);expect(html).toContain('value="2" max="12"');expect(html).not.toContain('%');expect(html).not.toContain('الوقت المتبقي');
 const unknown=renderToStaticMarkup(<EngineTestResult status={state} {...props}/>);expect(unknown).not.toContain('<progress');
});
it('cost review is explicit and unknown estimates cannot dispatch',async()=>{
 const calls:Array<{operation:string;input:unknown;requestId?:string}>=[];
 await executeEngineTest(async(operation,input,requestId)=>{calls.push({operation,input,requestId});return state;},quote,'same-test-intent');
 expect(calls).toEqual([{operation:'admin.engine.test.execute',input:{id:'engine-one',quoteId:'quote-one',requestId:'same-test-intent',approved:true},requestId:'same-test-intent'}]);
 for(const q of [{...quote,dispatchAvailable:false},{...quote,estimatedMicroUSD:null},{...quote,expiresAt:1}])await expect(executeEngineTest(async()=>{throw Error('MUST_NOT_CALL');},q,'never')).rejects.toThrow('غير قابل للتنفيذ');
 const html=renderToStaticMarkup(<EngineTestQuoteReview quote={{...quote,estimatedMicroUSD:null}} busy={false} onApprove={noop} onCancel={noop}/>);expect(html).toContain('غير معروف');expect(html).toContain('ليس سقف فاتورة');expect(html).toMatch(/disabled=""[^>]*>أوافق على الكلفة/);
});
it('ambiguous test submission is never automatically retried',async()=>{
 let calls=0;await expect(executeEngineTest(async()=>{calls++;throw Error('network disconnected');},quote,'ambiguous-one')).rejects.toThrow('network disconnected');expect(calls).toBe(1);
});
it('a FLUX prompt creates only an owned local test project before requesting a scoped quote',async()=>{
 const calls:Array<{op:string;input:unknown}>=[];const result=await prepareModelTestQuote(async(op,input)=>{calls.push({op,input});return op==='admin.engine.test.project'?{projectId:'test-project',stageId:'scene_image:shot-one',modelId:'flux2-klein-4b',needsInputs:[]}:quote;},'engine-one',{prompt:'شخصية عراقية',orientation:'portrait'});
 expect(result).toEqual(quote);expect(calls).toEqual([{op:'admin.engine.test.project',input:{id:'engine-one',input:{prompt:'شخصية عراقية',orientation:'portrait'}}},{op:'admin.engine.test.quote',input:{id:'engine-one',input:{projectId:'test-project',stageId:'scene_image:shot-one'}}}]);expect(calls.some(c=>c.op==='admin.engine.test.execute')).toBe(false);
});
it('a ready owned stage skips project creation and never forwards unrelated fields into its quote',async()=>{
 const calls:Array<{op:string;input:unknown}>=[];await prepareModelTestQuote(async(op,input)=>{calls.push({op,input});return quote;},'engine-one',{projectId:'own-project',stageId:'voice:line-one',prompt:'not quoted',orientation:'landscape'});expect(calls).toEqual([{op:'admin.engine.test.quote',input:{id:'engine-one',input:{projectId:'own-project',stageId:'voice:line-one'}}}]);
});
it('missing real voice or reference inputs cannot be mistaken for a runnable test project',async()=>{
 const calls:string[]=[];await expect(prepareModelTestQuote(async op=>{calls.push(op);return {projectId:'p',stageId:'voice:u',needsInputs:['voiceProfileId']};},'engine-one',{text:'هلا'})).rejects.toThrow('يحتاج صوراً مرجعية أو صوتاً معتمداً');expect(calls).toEqual(['admin.engine.test.project']);
});
