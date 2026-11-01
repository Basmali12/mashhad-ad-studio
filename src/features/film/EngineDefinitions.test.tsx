import React from 'react';
import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {ENGINE_MODEL_CATALOG} from '../../../shared/engine-catalog';
import type {FilmEngineQuote} from '../../../shared/film-contracts';
import {mayDispatchPaidWork} from '../../../shared/film-request-policy';
import EngineDefinitions,{approveDefinitionQuote,defaultModelResources,definitionCanStart,engineGiB,EngineDefinitionCard,EngineDefinitionForm,EnginePreparationProgress,EngineQuoteReview,type EngineDefinition} from './EngineDefinitions';

const definition:EngineDefinition={id:'definition-one',name:'محرك صور',modelId:ENGINE_MODEL_CATALOG[0].id,modelName:ENGINE_MODEL_CATALOG[0].name,version:null,kind:'image',variant:null,accountId:'account-one',gpu:'RTX-PRO-6000',cpu:4,ramGiB:96,minVramGiB:null,volume:'private-volume',weightPath:null,preparationState:'needs_manifest',deploymentState:'unpublished',enabled:false,adapterAvailable:false,hourPriceUSD:'3.000000',blockers:['ADAPTER_NOT_INSTALLED'],runtime:{state:'stopped',cloudStopped:true,elapsedSeconds:0,estimatedCustomerUSD:null,recordedProviderUSD:null,error:null}};
const noop=()=>{};
it('renders only metadata on initial admin render and cannot dispatch paid work',()=>{
 let calls=0;const html=renderToStaticMarkup(<EngineDefinitions request={async()=>{calls++;throw Error('NO_CLOUD');}} accounts={[]}/>);
 expect(calls).toBe(0);expect(html).toContain('سجل المحركات الجديدة');expect(html).toContain('لا تنزيل أو تشغيل تلقائي');expect(html).not.toContain('Token Secret');
});
it('preserves nine inactive presets, account association and only the two approved GPUs',()=>{
 const html=renderToStaticMarkup(<EngineDefinitionForm models={ENGINE_MODEL_CATALOG} accounts={[{id:'account-one',label:'حساب محفوظ'},{id:'removed',label:'حساب مفصول',unlinked:true}]} busy={false} onSave={async()=>{throw Error('NO_DISPATCH');}}/>);
 expect(ENGINE_MODEL_CATALOG).toHaveLength(9);for(const model of ENGINE_MODEL_CATALOG)expect(html).toContain(model.name.replace(/&/g,'&amp;'));
 expect(html).toContain('RTX PRO 6000 — 96GB');expect(html).toContain('L40S — 48GB');expect(html).not.toContain('A100');expect(html).not.toContain('H100');
 expect(html).toContain('حساب محفوظ');expect(html).not.toContain('حساب مفصول');expect(html).toContain('متطلب VRAM الموثق');expect(html).toContain('غير مختبر');expect(html).toContain('حفظ التعريف بدون تشغيل');
});
it('unknown model resources and absent adapter cannot become ready or startable from a saved definition',()=>{
 expect(definitionCanStart(definition)).toBe(false);expect(definitionCanStart({...definition,enabled:true})).toBe(false);
 const html=renderToStaticMarkup(<EngineDefinitionCard definition={definition} busy={false} onEdit={noop} onInspect={noop} onStatus={noop} onQuote={noop} onStop={noop}/>);
 expect(html).toContain('إصدار غير مثبت');expect(html).toContain('متطلب VRAM: غير مختبر');expect(html).toContain('يحتاج عقد ملفات معتمداً');expect(html).toContain('غير منشور');expect(html).toContain('كلفة المورد المسجلة: غير متاحة');
 expect(html).toContain('disabled="">تشغيل');expect(html).toContain('disabled="">إيقاف المحرك');expect(html).not.toContain('100%');
});
it('stop remains available for unresolved resources even when the adapter is absent',()=>{
 const html=renderToStaticMarkup(<EngineDefinitionCard definition={{...definition,runtime:{...definition.runtime,state:'failed',cloudStopped:false,error:'RESOURCE_STATE_UNKNOWN'}}} busy={false} onEdit={noop} onInspect={noop} onStatus={noop} onQuote={noop} onStop={noop}/>);
 expect(html).toContain('class="film-danger">إيقاف المحرك');expect(html).toContain('disabled="">تشغيل');expect(html).toContain('RESOURCE_STATE_UNKNOWN');
});
const prepareQuote:FilmEngineQuote={id:'quote-one',engineId:'definition-one',action:'prepare',expiresAt:Date.now()+300000,settingsRevision:1,expectedBytes:Math.round(14.88*1024**3),missingBytes:4096,fileCount:3,missingFiles:[{path:'transformer/model.safetensors',size:4096}],estimate:{resourceWindowUSD:null,networkUSD:null,buildUSD:null,storageUSDPerMonth:null,recordedUSD:null,note:'ليس سقف فاتورة'},dispatchAvailable:true,blockers:[]};
it('preparation quote shows measured model size and missing files without executing or inventing costs',()=>{
 let calls=0;const html=renderToStaticMarkup(<EngineQuoteReview quote={prepareQuote} busy={false} onApprove={()=>calls++} onCancel={noop}/>);
 expect(calls).toBe(0);expect(html).toContain('14.88 GiB');expect(html).toContain('transformer/model.safetensors');expect(html).toContain('تجهيز الأوزان');expect(html).toContain('غير متاحة');expect(html).toContain('CPU');expect(html).toContain('القيم غير المعروفة لا تعني');expect(engineGiB(undefined)).toBe('غير معروف');
});
it('explicit preparation approval keeps its request identity and is never routed to GPU start',async()=>{
 const calls:Array<{operation:string;input:unknown;requestId?:string}>=[];await approveDefinitionQuote(async(operation,input,requestId)=>{calls.push({operation,input,requestId});return {id:'operation-one'};},prepareQuote,'same-approval');
 expect(calls).toEqual([{operation:'admin.engine.prepare',input:{id:'definition-one',quoteId:'quote-one',requestId:'same-approval',approved:true},requestId:'same-approval'}]);
 await expect(approveDefinitionQuote(async()=>{throw Error('MUST_NOT_DISPATCH');},{...prepareQuote,dispatchAvailable:false},'disabled')).rejects.toThrow('غير قابل للتنفيذ');expect(mayDispatchPaidWork('admin.engine.prepare')).toBe(true);expect(mayDispatchPaidWork('admin.engine.status')).toBe(false);expect(mayDispatchPaidWork('admin.engine.quote')).toBe(false);
});
it('preparation uses real counters only and unknown metrics remain indeterminate',()=>{
 const measured=renderToStaticMarkup(<EnginePreparationProgress value={{status:'running',cloudStopped:false,error:null,progress:{completed:512,total:1024,unit:'bytes'}}}/>);expect(measured).toContain('value="512" max="1024"');expect(measured).toContain('البايتات المسجلة');expect(measured).toContain('الوقت المتبقي: غير معروف');
 const unknown=renderToStaticMarkup(<EnginePreparationProgress value={{status:'running',cloudStopped:false,error:null,progress:null}}/>);expect(unknown).toContain('<progress aria-label=');expect(unknown).not.toContain('value=');
 const hashed=renderToStaticMarkup(<EnginePreparationProgress value={{status:'running',cloudStopped:false,error:null,progress:{completed:512,total:1024,unit:'source_bytes_hashed'}}}/>);expect(hashed).not.toContain('value=');
});
it('software installed is distinct from weight readiness, and active CPU preparation can be stopped',()=>{
 const value={...definition,enabled:true,softwareInstalled:true,adapterAvailable:true,expectedBytes:prepareQuote.expectedBytes,blockers:['ENGINE_NOT_READY'],preparation:{status:'running',cloudStopped:false,error:null,progress:null}};
 const html=renderToStaticMarkup(<EngineDefinitionCard definition={value} busy={false} onEdit={noop} onInspect={noop} onStatus={noop} onQuote={noop} onPrepareQuote={noop} onStop={noop}/>);expect(definitionCanStart(value)).toBe(false);expect(html).toContain('برنامج المحرك مثبت');expect(html).toContain('14.88 GiB');expect(html).toContain('class="film-danger">إيقاف المحرك');expect(html).toContain('disabled="">تشغيل');
});
it('server model resource defaults are used without overwriting saved resource and hourly-price values',()=>{
 const model={...ENGINE_MODEL_CATALOG.find(m=>m.id==='habibi-irq')!,runtimeProfile:{gpu:'L40S',cpu:2,ramGiB:16,minVramGiB:8,version:'0.1.1-specialized'}};
 expect(defaultModelResources(model)).toEqual({gpu:'L40S',cpu:2,ramGiB:16,minVramGiB:8});
 const fresh=renderToStaticMarkup(<EngineDefinitionForm models={[model]} accounts={[{id:'saved',label:'حساب محفوظ'}]} busy={false} onSave={async()=>{}}/>);
 expect(fresh).toContain('<summary>الموارد والإعدادات التقنية المتقدمة</summary>');expect(fresh).toContain('value="16"');expect(fresh).toContain('value="8"');expect(fresh).toContain('value="L40S" selected=""');
 const saved=renderToStaticMarkup(<EngineDefinitionForm models={[model]} accounts={[{id:'saved',label:'حساب محفوظ'}]} definition={{...definition,modelId:model.id,gpu:'RTX-PRO-6000',cpu:4,ramGiB:96,hourPriceUSD:'3.000000'}} busy={false} onSave={async()=>{}}/>);expect(saved).toContain('value="96"');expect(saved).toContain('value="3.000000"');
});
