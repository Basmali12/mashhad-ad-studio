import React from 'react';
import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import ProductionView,{DirectorPlanCard} from './ProductionView';
import type {DirectorState,ProductionOffer,ProductionProject} from './directorClient';

const noop=()=>{};
const project:ProductionProject={id:'film-one',title:'الأمانة',state:'running',durationMs:60000,revision:2,activity:{label:'تحريك المشاهد',progress:{completed:4,total:20,unit:'steps'}},stages:[{id:'image-one',kind:'character_image',state:'completed'},{id:'animate-one',kind:'animate',state:'running'}],result:null};
const speaker={id:'salim',name:'سالم',voice:{voiceId:'approved-salim',engineId:'habibi-irq',locale:'ar-IQ'}};
const state:DirectorState={projectId:'film-one',revision:2,mode:'strict',originalText:'القصة الأصلية',messages:[],summary:'',missing:[],planReady:true,storyApproved:false,orientation:'portrait',pendingRevision:{id:'revision-one',summary:'الخطة جاهزة'},outline:{title:'الأمانة',summary:'يحافظ سالم على الأمانة.',durationMs:60000,characters:[speaker],narrators:[],chapters:[{id:'chapter-one',title:'الفصل الأول'}]},approvalReview:{title:'الأمانة',durationMs:60000,chapterCount:1,sceneCount:4,shotCount:12,models:['flux2-klein-4b','wan22-i2v-a14b','habibi-irq'],readiness:[{modelId:'flux2-klein-4b',state:'ready'},{modelId:'wan22-i2v-a14b',state:'unassigned'},{modelId:'habibi-irq',state:'prepared_disabled'}]}};
const quote:ProductionOffer={id:'quote-one',projectId:'film-one',estimatedMicroUSD:50000,spendLimitMicroUSD:50000,dispatchAvailable:false,blockers:['PRODUCTION_MODEL_NOT_PUBLISHED'],expiresAt:Date.now()+60000};
const props={onAdopt:noop,onQuote:noop,onApprove:noop,onCancel:noop,busy:false,balance:100000};

it('shows exact scene plan, voices, aspect ratio and distinct readiness without claiming publication',()=>{
 const html=renderToStaticMarkup(<DirectorPlanCard state={state} quote={null} {...props}/>);expect(html).toContain('الأمانة');expect(html).toContain('60 ثانية');expect(html).toContain('1 فصول');expect(html).toContain('4 مشاهد');expect(html).toContain('12 لقطات');expect(html).toContain('عمودي 9:16');expect(html).toContain('720p');expect(html).toContain('approved-salim');expect(html).toContain('ar-IQ');expect(html).toContain('غير جاهز أو غير مربوط');expect(html).toContain('اعتماد السيناريو — دون تشغيل');expect(html).not.toContain('ابدأ الإنتاج');
});
it('unpublished engines leave the explicit production confirmation disabled even when the wallet has funds',()=>{
 const html=renderToStaticMarkup(<DirectorPlanCard state={{...state,storyApproved:true}} quote={quote} {...props}/>);expect(html).toContain('المحرك غير منشور');expect(html).toMatch(/disabled=""[^>]*>أوافق على التكلفة — ابدأ الإنتاج/);expect(html).toContain('الحد الأعلى الموافق عليه');expect(html).toContain('$0.05');
});
it('a ready offer is still disabled until the screenplay has been adopted',()=>{
 const html=renderToStaticMarkup(<DirectorPlanCard state={state} quote={{...quote,dispatchAvailable:true,blockers:[]}} {...props}/>);expect(html).toMatch(/disabled=""[^>]*>أوافق على التكلفة — ابدأ الإنتاج/);
});
it('insufficient balance is not presented as an enabled production approval',()=>{
 const html=renderToStaticMarkup(<DirectorPlanCard state={{...state,storyApproved:true}} quote={{...quote,dispatchAvailable:true,blockers:[]}} {...props} balance={1}/>);expect(html).toMatch(/disabled=""[^>]*>أوافق على التكلفة — ابدأ الإنتاج/);
});
it('actual provider steps are shown without a fabricated clock, ETA or generated duration',()=>{
 const html=renderToStaticMarkup(<ProductionView project={project} onBack={noop} onCancel={noop} onWatch={noop} busy={false}/>);expect(html).toContain('تحريك المشاهد');expect(html).toContain('value="4" max="20"');expect(html).toContain('steps');expect(html).toContain('صور الشخصيات');expect(html).not.toContain('دقيقة و');expect(html).not.toContain('مدة الوسائط المقاسة');expect(html).not.toContain('تشغيل الفيديو المكتمل');expect(html).not.toContain('<video');expect(html).not.toContain('تنزيل');
});
it('missing real progress waits for server updates rather than inventing a percentage',()=>{
 const html=renderToStaticMarkup(<ProductionView project={{...project,activity:{label:'توليد الأصوات'}}} onBack={noop} onCancel={noop} onWatch={noop} busy={false}/>);expect(html).toContain('بانتظار تحديث المرحلة من الخادم');expect(html).not.toContain('<progress');expect(html).not.toContain('%');
});
it('only a completed final result enables opening the existing files tab and stops the robot animation',()=>{
 const html=renderToStaticMarkup(<ProductionView project={{...project,state:'completed',activity:{label:'مكتمل'},measuredDurationMs:59400,result:{fileId:'final-one',durationMs:59400}}} onBack={noop} onCancel={noop} onWatch={noop} busy={false}/>);expect(html).toContain('تشغيل الفيديو المكتمل');expect(html).toContain('59.4 ثانية');expect(html).not.toContain('is-active');expect(html).not.toContain('<video');expect(html).not.toContain('تنزيل');
});
it('completed status without a final artifact does not invent a playable film',()=>{
 const html=renderToStaticMarkup(<ProductionView project={{...project,state:'completed',result:null}} onBack={noop} onCancel={noop} onWatch={noop} busy={false}/>);expect(html).not.toContain('تشغيل الفيديو المكتمل');
});
