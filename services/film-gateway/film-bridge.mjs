import {providerFetch as fetch} from './network.mjs';
import {mayDispatchPaidWork} from '../../shared/film-request-policy.ts';
import { createHmac, randomUUID } from 'node:crypto';
import { FILM_OPERATIONS } from "../../shared/film-contracts.ts";
// Browser consumers import the frozen type-only contract from services/film-engine/engine/film-contracts.
const operations = new Set(FILM_OPERATIONS);
const LIMIT = 262144;
const FOLLOW = 'افتح متابعة الجلسة أو المشروع لمعرفة الحالة؛ لا تبدأ محاولة مدفوعة جديدة تلقائياً.';
const fail = (error, message = 'تعذر إكمال الطلب بأمان.', followExisting = false) => ({ error, message: message + (followExisting ? ' ' + FOLLOW : ''), followExisting });
const record = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const id = (x) => typeof x === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(x);
// eslint-disable-next-line no-control-regex -- reject control characters at the authenticated input boundary.
const text = (x, max = 20000) => typeof x === 'string' && x.length > 0 && x.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(x);
const money = (x) => typeof x === 'string' && /^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/.test(x);
const yes = x => x === true;
const bool = x => typeof x === 'boolean';
const integer = x => Number.isSafeInteger(x) && x >= 0;
const date = x => x === null || (integer(x) && x > 0);
const short = x => text(x, 120);
const modelId = x => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(x);
const gpu = x => ['RTX-PRO-6000','L40S'].includes(x);
const cpu = x => integer(x) && x >= 1 && x <= 64;
const ramGiB = x => integer(x) && x >= 1 && x <= 1024;
const productionStageId = x => typeof x==='string'&&/^[A-Za-z0-9_:-]{1,180}$/.test(x);
const referenceIds = x => Array.isArray(x)&&x.length<=100&&x.every(id)&&new Set(x).size===x.length;
const minVramGiB = x => integer(x) && x >= 1 && x <= 192;
const testObject=(value,schema)=>record(value)&&Object.keys(value).every(k=>Object.hasOwn(schema,k)||Object.hasOwn(schema,k+'?'))&&Object.entries(schema).every(([key,check])=>key.endsWith('?')&&!(key.slice(0,-1) in value)||check(value[key.replace(/\?$/,'')]));
const engineTestProjectInput=x=>testObject(x,{'prompt?':v=>text(v,2000),'text?':v=>text(v,300),'orientation?':v=>['portrait','landscape'].includes(v),'projectId?':id,'stageId?':productionStageId,'referenceIds?':v=>referenceIds(v)&&v.length<=4,'voiceProfileId?':id});
const engineTestStageInput=x=>testObject(x,{projectId:id,stageId:productionStageId});
const fields = {
    'sfx.list': {id},
    'sfx.event.approve': {id,shotId:id,eventId:id,videoAssetId:id,offsetMs:x=>integer(x)&&x<=3600000,reviewed:yes},
    'final.quality.get': {id,assetId:id},
    'final.quality.review': {id,assetId:id,reviewed:yes,accepted:yes},
    'production.costs': {id},
    'sync.face.approve': {id,shotId:id,characterId:id,videoAssetId:id,trackId:x=>x==='face-0',faceCount:x=>x===1,reviewed:yes},
    'sync.asset.get': {id,assetId:id},
    'sync.review': {id,assetId:id,kind:x=>x==='alignment'||x==='video',reviewed:yes,accepted:yes},
    'sync.timeline.get': {id,'offset?':x=>integer(x)&&x<=100000,'limit?':x=>integer(x)&&x>=1&&x<=200},
    'director.get': {id},
    'director.source.set': {id,sourceId:id,requestId:id,approved:yes},
    'production.source.begin': {requestId:id,totalCharacters:x=>integer(x)&&x>=1&&x<=1000000},
    'production.source.chunk': {id,index:x=>integer(x)&&x<=83,text:x=>text(x,12000)},
    'production.source.complete': {id,chunkCount:x=>integer(x)&&x>=1&&x<=84},
    'production.source.get': {id,offset:x=>integer(x)&&x<=1000000,limit:x=>integer(x)&&x>=1&&x<=12000},
    'production.reference.attach': {id,sourceProjectId:id},
    'production.legacy.import': {id,requestId:id},
    'production.organize': {id,action:x=>['rename','pin','unpin','archive','restore'].includes(x),'name?':short},
    'director.research.quote': {id,requestId:id,'query?':x=>text(x,1000),'maxCalls?':x=>integer(x)&&x>=1&&x<=2,'maxTokens?':x=>integer(x)&&x>=500&&x<=3000,'approvedExpansion?':bool},
    'director.research': {id,quoteId:id,requestId:id,approvedTextCost:yes},
    'director.message.quote': {id,requestId:id,'text?':x=>text(x,30000),'textId?':id,'mode?':x=>x==='strict'||x==='creative'},
    'director.message': {id,quoteId:id,requestId:id,approvedTextCost:yes},
    'director.plan.quote': {id,requestId:id,stage:x=>['outline','chapter','chapter_outline','scene','revision','source_summary'].includes(x),'sourceIndex?':x=>integer(x)&&x<=41,'chapterId?':id,'sceneId?':id,'targetType?':x=>['shot','scene','character','voice','chapter'].includes(x),'targetId?':id},
    'director.plan': {id,quoteId:id,requestId:id,approvedTextCost:yes},
    'director.call': {id,requestId:id},
    'director.approve': {id,revisionId:id,requestId:id,approved:yes},
    'director.cancel': {id,requestId:id,approved:yes},
    'production.create': {requestId:id,title:short,'story?':x=>text(x,30000),'sourceId?':id,durationMs:x=>integer(x)&&x>=10000&&x<=3600000,'referenceIds?':referenceIds},
    'production.get': {id}, 'production.list': {'archived?':bool},
    'production.plan': {id,requestId:id}, 'production.quote': {id,'phase?':x=>x==='images'||x==='animation'||x==='audio'||x==='synchronization'},
    'production.approve': {id,quoteId:id,requestId:id,approved:yes,spendLimitMicroUSD:integer},
    'production.retry': {id,stageId:productionStageId,quoteId:id,requestId:id,approved:yes},
    'production.cancel': {id,approved:yes},
    'admin.engine.models': {}, 'admin.engine.list': {},
    'admin.engine.save': {'id?':id,modelId,accountId:id,name:short,'version?':x=>x===null||short(x),gpu,cpu,ramGiB,'minVramGiB?':x=>x===null||minVramGiB(x),'volume?':x=>x===''||id(x),hourPriceUSD:money},
    'admin.engine.inspect': {id}, 'admin.engine.status': {id},
    'admin.engine.quote': {id,action:x=>['start','prepare'].includes(x)},
    'admin.engine.start': {id,quoteId:id,requestId:id,approved:yes},
    'admin.engine.prepare': {id,quoteId:id,requestId:id,approved:yes},
    'admin.engine.stop': {id,approved:yes},
    'admin.engine.test.project':{id,input:engineTestProjectInput},
    'admin.engine.test.quote':{id,'input?':engineTestStageInput},
    'admin.engine.test.execute':{id,quoteId:id,requestId:id,approved:yes},
    'admin.engine.test.status':{id,'testId?':id,'requestId?':id},
    'admin.engine.test.review':{id,testId:id,approved:yes,accept:bool},
    'admin.engine.test.stop':{id,'testId?':id,approved:yes},
    'admin.engine.approve':{id,testId:id,approved:yes},
    'admin.engine.publish':{id,approved:yes},
    'admin.engine.unpublish':{id,approved:yes},
    'admin.engine.test.asset.ticket':{id,testId:id,assetId:id},
    'files.list': {}, 'files.ticket': {id,'download?':bool,'thumbnail?':bool}, 'files.delete': { id, approved: yes },
    'preferences.get': {},'preferences.save': {orientation:x=>x===null||['portrait','landscape'].includes(x)},
    'projects.list': {'archived?':bool},
    'project.organize': {id,'name?':short,'pinned?':bool,'archived?':bool},
    'rental.quote': { serverId: id },
    'rental.start': { serverId: id, revision: integer, priceMicroUSD: integer, approved: yes, requestId: id },
    'rental.status': { id }, 'rental.stop': { id },
    'project.save': { 'id?': id, name: short, story: x => text(x), seconds: x => integer(x) && x >= 10 && x <= 300 && x % 10 === 0, orientation: x => x===null||['portrait', 'landscape'].includes(x) },
    'project.preview.execute': {projectId:id,quoteId:id,approved:yes}, 'project.preview.view': {projectId:id},
    'project.reference.view': { projectId: id }, 'project.reference.ticket': { projectId: id }, 'project.reference.remove': { projectId: id },
    'project.get': { id }, 'project.follow': { id },
    'chat.submit': { projectId: id, message: x => text(x), approved: yes },
    'plan.submit': { projectId: id, approved: yes },
    'review.submit': { projectId: id, approved: yes },
    'text.status': { projectId: id }, 'plan.status': { projectId: id },
    'project.launch': { projectId: id, serverId: id, revision: integer, priceMicroUSD: integer, approved: yes, requestId: id },
    'project.generate': { projectId: id, rentalId: id, approved: yes, 'directorFollow?': bool },
    'project.resume': { projectId: id, rentalId: id, approved: yes, 'directorFollow?': bool },
    'project.merge': { projectId: id }, 'media.ticket': { projectId: id, 'download?': bool, index: x => x === 'merged' || (integer(x) && x < 30) },
    'admin.credit.add': { customerId: id, amountUSD: money, requestId: id },
    'admin.account.link': { name: short, tokenId: x => typeof x === 'string' && /^ak-[A-Za-z0-9_-]{8,200}$/.test(x), tokenSecret: x => typeof x === 'string' && /^as-[A-Za-z0-9_-]{8,200}$/.test(x) },
    'admin.account.inspect': { accountId: id }, 'admin.account.activate': { accountId: id }, 'admin.account.unlink': { accountId: id, approved: yes },
    'admin.account.lock': { accountId: id, locked: bool }, 'admin.account.stop': { accountId: id, approved: yes },
    'admin.prepare.quote': { accountId: id }, 'admin.prepare.execute': { quoteId: id, approved: yes },
    'admin.test.quote': { id, prompt: x => text(x, 9000), audioContract: x => record(x) && JSON.stringify(x).length <= 20000 },
    'admin.test.execute': { quoteId: id, approved: yes }, 'admin.operation.status': { id },
    'admin.test.status': {id}, 'admin.test.ticket': {id,jobId:id,'download?':bool}, 'admin.test.publish': {id,jobId:id,reviewed:yes},
    'admin.slot.save': { 'id?': id, accountId: id, name: short, hourPriceUSD: money, 'gpu?': x => ['RTX-PRO-6000', 'L40S'].includes(x) },
    'admin.slot.reassign': { id, accountId: id, approved: yes },
    'admin.slot.verify': { id, jobId: id, reviewed: yes }, 'admin.slot.publish': { id, 'testingOnly?': bool, 'approved?': yes },
    'admin.slot.retire': { id, approved: yes },
    'admin.slot.lock': { id, locked: bool }, 'admin.slot.stop': { id, approved: yes },
    'admin.capacity.save': { accountId: id, maxConcurrent: x => x === 1 || x === 2 },
    'admin.billing.save': { accountId: id, remainingUSD: x => x === null || money(x), expiresAt: date, renewsAt: date },
    'admin.alert.ack': { id }, 'admin.text.key.save': { key: x => typeof x === 'string' && /^sk-[A-Za-z0-9_-]{12,500}$/.test(x) },
};
function validInput(operation, input) {
    if (!record(input))
        return false;
    if(operation==='production.create'&&('story' in input)===('sourceId' in input))return false;
    if(operation==='director.message.quote'&&('text' in input)===('textId' in input))return false;
    if(operation==='production.organize'&&(input.action==='rename'?!('name' in input):'name' in input))return false;
    const schema = fields[operation] ?? {};
    const allowed = Object.keys(schema).map(k => k.replace(/\?$/, ''));
    return Object.keys(input).every(k => allowed.includes(k)) && Object.entries(schema).every(([key, check]) => {
        const optional = key.endsWith('?');
        const name = key.replace(/\?$/, '');
        return optional && !(name in input) || check(input[name]);
    });
}
const wallet = { balanceMicroUSD: 'value', expiresAt: 'value', reservedMicroUSD: 'value', activeRentalId: 'id', lots: [{ amountMicroUSD: 'value', remainingMicroUSD: 'value', expiresAt: 'value', expired: 'value' }] };
const server = { id: 'id', name: 'text', gpu: 'text', ram: 'value', cpu: 'value', pricePerHourUSD: 'value', state: 'text', availability: 'text' };
const rental = { stages:[{phase:'text',state:'text'}], id: 'id', serverId: 'id', state: 'text', elapsedSeconds: 'value', billedMicroUSD: 'value', hourPriceUSD: 'value', lowFunds: 'value', phase: 'text', completed: 'value', total: 'value', stopReason: 'text', message: 'text' };
const visualReview={index:'value',model:'text',summary:'text',visibleText:'text',continuity:'text',causalOrder:'text',audioAssessment:'text',findings:['text'],suggestedCorrections:['text'],sampleCount:'value',computedUSD:'value',invoiceUSD:'value'};
const project = {orientationConfirmed:'value',pinned:'value',archived:'value',preview:{id:'id',status:'text',estimatedUSD:'value',computedUSD:'value',invoiceUSD:'value',expiresAt:'value',error:'text',model:'text'},discussion:{readyToWrite:'value',seconds:'value',style:'text'},launch:{state:'text',approvedAt:'value',finishedAt:'value'},directorFollow:'value',reviewPending:'value',reviewState:'text',visualReviews:[visualReview], id: 'id', name: 'text', story: 'text', messages: [{ role: 'text', content: 'text', hasReference:'value' }], seconds: 'value', orientation: 'text', state: 'text', reference: { mime: 'text', size: 'value', width: 'value', height: 'value', uploadedAt: 'value' }, textPending: 'value', textUncertain: 'value', textCostPolicy: 'text', planningCompletedScenes: 'value', merge: { status: 'text', error: 'text', duration: 'value', width: 'value', height: 'value', nativeAudio: 'value' }, scenes: [{ durationSeconds:'value',stages:[{phase:'text',state:'text'}],index: 'value', title: 'text', mediaExpired:'value', visualPrompt:'text', status: 'text', dialogue: [{ speaker: 'text', text: 'text' }], phase: 'text', completed: 'value', total: 'value', ready: 'value' }], error: 'text' };
const productionCharacter={id:'id',name:'text',description:'text',age:'value',face:'text',body:'text',wardrobe:'text',props:[{id:'id',description:'text'}],referenceIds:['id'],angles:['text'],voice:{engineId:'text',voiceId:'id',locale:'text'},relationships:[{characterId:'id',description:'text'}]};
const productionTimeline={truncated:'value',chapters:[{id:'id',title:'text',startMs:'value',endMs:'value'}],scenes:[{id:'id',chapterId:'id',description:'text',startMs:'value',endMs:'value'}],shots:[{id:'id',chapterId:'id',sceneId:'id',startMs:'value',endMs:'value',prompt:'text',location:'text',characterMotion:'text',cameraMotion:'text',requires_lip_sync:'value',audioCue:{utteranceId:'id',wordIndex:'value',sentenceIndex:'value'},transition:{type:'transitionType',durationMs:'nonnegativeValue',requested:'value'},soundEffects:[{id:'id',description:'text',startMs:'value',endMs:'value',assetId:'id',layer:'text',category:'text',gainDb:'value',duckingRequested:'value',sourceOffsetMs:'nonnegativeValue',requested:'value',eventAnchor:{eventId:'id',offsetMs:'nonnegativeValue',durationMs:'nonnegativeValue'}}],characterIds:['id'],propIds:['id'],referenceIds:['id'],utteranceIds:['id'],eventIds:['id'],intentionalRepeatOf:'id'}],utterances:[{id:'id',characterId:'id',narratorId:'id',role:'text',expression:'text',text:'text',startMs:'value',endMs:'value',requires_lip_sync:'value',intentionalRepeat:'value',repeatOf:'id',allowOverlap:'value'}]};
const productionResult={artifactId:'id',sha256:'sha256',bytes:'value',durationMs:'value',width:'value',height:'value',hasAudio:'value',mediaId:'id',mediaReady:'value'};
const productionProject={storyTruncated:'value',createdAt:'value',updatedAt:'value',referenceIds:['id'],timelineCounts:{chapters:'value',scenes:'value',shots:'value',utterances:'value'},stageCounts:{total:'value',completed:'value'},pinned:'value',archived:'value',orientation:'text',source:{id:'id',characters:'value',sha256:'sha256'},activity:{code:'text',label:'text',stageId:'stageId',progress:{completed:'value',total:'value',unit:'text'}},measuredDurationMs:'nonnegativeValue',error:'productionError',completedPhases:'productionCompletedPhases',cancelRequested:'value',id:'id',title:'text',story:'text',durationMs:'value',state:'text',revision:'value',characters:[productionCharacter],narrators:[{id:'id',name:'text',voice:{engineId:'text',voiceId:'id',locale:'text'}}],timeline:productionTimeline,stages:[{id:'stageId',kind:'text',state:'text',attempts:'value',progress:{completed:'value',total:'value',unit:'text'},error:'productionError',result:{assetIds:['id']}}],result:productionResult};
const productionQuote={availableMicroUSD:'microUSD',canAfford:'value',phase:'productionPhase',id:'id',projectId:'id',planRevision:'value',estimatedMicroUSD:'value',dispatchAvailable:'value',expiresAt:'value',stages:[{id:'stageId',kind:'text',estimatedMicroUSD:'value',available:'value',blockers:['productionError']}],blockers:['productionError']};
const directorEvent={id:'id',description:'text',sourceStart:'value',sourceEnd:'value',characterIds:['id'],location:'text',stateAfter:'text',documented:'value'};
const directorNarrator={id:'id',name:'text',voice:{engineId:'text',voiceId:'id',locale:'text'}};
const directorState={outlineTruncated:'value',sourceSummariesReady:'value',sourceSummariesTotal:'value',originalTextTruncated:'value',source:{id:'id',characters:'value',sha256:'sha256'},pendingCall:{requestId:'id',status:'text',stage:'text'},nextAction:{stage:'text',chapterId:'id',sceneId:'id',sourceIndex:'value'},orientation:'text',targetDurationMs:'value',lastIntent:'text',projectId:'id',mode:'text',originalText:'text',revision:'value',storyApproved:'value',summary:'text',messages:[{id:'id',role:'text',text:'text',createdAt:'value'}],outline:{truncated:'value',title:'text',summary:'text',durationMs:'value',characters:[productionCharacter],narrators:[directorNarrator],chapters:[{id:'id',title:'text',summary:'text',startMs:'value',endMs:'value',sourceStart:'value',sourceEnd:'value',events:[directorEvent]}],warnings:['text']},chapterStates:[{id:'id',state:'text'}],sceneStates:[{id:'id',chapterId:'id',state:'text'}],revisions:[{id:'id',stage:'text',targetType:'text',targetId:'id',createdAt:'value',applied:'value',approved:'value'}],planReady:'value',missing:['text'],editSuggestion:{scope:'text',targetType:'text',targetId:'id',chapterId:'id',instruction:'text'},researchSuggestion:{needed:'value',query:'text',reason:'text'},researchResults:[{id:'id',summary:'text',claims:[{id:'id',text:'text',sourceUrls:['researchUrl'],status:'text'}],sources:[{url:'researchUrl',title:'text'}],citations:[{url:'researchUrl',title:'text',startIndex:'value',endIndex:'value'}],originalScenario:'text',rightsNotes:['text'],needsMoreResearch:'value',createdAt:'value',expiresAt:'value'}],proposedTimeline:productionTimeline,pendingRevision:{id:'id',stage:'text',targetType:'text',targetId:'id',summary:'text',changedIds:['id']},approvalReview:{title:'text',durationMs:'value',chapterCount:'value',sceneCount:'value',shotCount:'value',voiceIds:['id'],models:['text'],estimatedMicroUSD:'value',spendLimitMicroUSD:'value',readiness:[{modelId:'text',state:'text'}],durationIsEstimate:'value',productionQuoteRequired:'value'},error:'directorError'};
const directorQuote={cached:'value',id:'id',projectId:'id',stage:'text',estimatedMicroUSD:'value',model:'text',expiresAt:'value',dispatchAvailable:'value',blockers:['directorError']};
const directorCall={id:'id',projectId:'id',status:'text',stage:'text',revisionId:'id',error:'directorError',usage:{inputTokens:'value',cachedInputTokens:'value',cacheWriteTokens:'value',outputTokens:'value',computedUSD:'value',providerCostUSD:'value',webSearchCalls:'value',webSearchToolUSD:'value'},estimatedMaxUSD:'value',model:'text'};
const syncFace={id:'id',faceBindingId:'id',projectId:'id',shotId:'id',characterId:'id',videoAssetId:'id',trackId:'id',faceCount:'singleFaceCount',reviewed:'value',sourceVideoSHA256:'sha256',createdAt:'value'};
const syncWord={text:'text',startMs:'value',endMs:'value',confidence:'value'};
const syncSentence={text:'text',startMs:'value',endMs:'value'};
const syncAsset={assetId:'id',kind:'text',utteranceId:'id',shotId:'id',speakerId:'id',characterId:'id',voiceProfileId:'id',durationMs:'value',sha256:'sha256',alignment:{words:[syncWord],sentences:[syncSentence],durationMs:'value',confidence:'value',needsReview:'value',accuracyCertified:'uncertified',transcriptVerified:'uncertified'},needsReview:'value',approved:'value',reviewed:'value',qualityCertified:'uncertified',reviewFindings:['text']};
const syncReview={assetId:'id',approved:'value',reviewed:'value',qualityCertified:'uncertified'};
const syncTimeline={projectId:'id',durationMs:'value',needsReview:'value',reviewReasons:'syncReviewReasons',visualExtensionRequests:[{shotId:'id',videoAssetId:'id',startMs:'value',endMs:'value',missingDurationMs:'value',approvalRequired:'requiredApproval',automaticExecution:'uncertified',reason:'text'}],offset:'value',totalShots:'value',shots:[{shotId:'id',sceneId:'id',chapterId:'id',videoAssetId:'id',startMs:'value',endMs:'value',sourceStartMs:'value',sourceEndMs:'value',utteranceIds:['id'],requiresLipSync:'value',roundingMs:'value'}],audioTracks:[{assetId:'id',utteranceId:'id',speakerId:'id',voiceProfileId:'id',startMs:'value',endMs:'value',sourceOffsetMs:'value'}],quality:{acousticAlignmentVerified:'uncertified',lipSynchronizationVerified:'uncertified',faceIdentityVerified:'uncertified'}};
const syncReviewCodes=new Set(['ALIGNMENT_MISSING','ALIGNMENT_SCOPE_MISMATCH','ALIGNMENT_NEEDS_REVIEW','ALIGNMENT_FAILED','ALIGNMENT_WORDS_MISSING','ALIGNMENT_LOW_CONFIDENCE','ALIGNMENT_TIMES_INVALID','ALIGNMENT_TRANSCRIPT_MISMATCH','ALIGNMENT_SENTENCES_INVALID','UNAPPROVED_SPEAKER_OVERLAP','AUDIO_MISSING','ACTUAL_DURATION_EXCEEDS_PLANNED_LIMIT','AUDIO_CUE_UNRESOLVED','AUDIO_CUE_OUTSIDE_TIMELINE','AUDIO_CUE_ORDER_INVALID','VIDEO_MISSING','VISUAL_COVERAGE_INSUFFICIENT','SHOT_TOO_SHORT_FOR_RELIABLE_NORMALIZATION','VISUAL_GRID_COVERAGE_INSUFFICIENT']);
const soundEffectAsset={id:'id',assetId:'id',name:'text',category:'text',durationMs:'nonnegativeValue',sampleRate:'nonnegativeValue',channels:'nonnegativeValue',bytes:'nonnegativeValue',sha256:'sha256',licenseAttested:'value',licenseVerified:'uncertified',approved:'value',createdAt:'value'};
const soundEffectBinding={id:'id',shotId:'id',eventId:'id',videoAssetId:'id',sourceSHA256:'sha256',offsetMs:'nonnegativeValue',reviewed:'value',timingVerified:'value',revision:'nonnegativeValue',createdAt:'value',reviewedAt:'value'};
const finalQualityInterval={startMs:'nonnegativeValue',endMs:'nonnegativeValue',durationMs:'nonnegativeValue',intentional:'value'};
const finalQuality={id:'id',projectId:'id',assetId:'id',sourceSHA256:'sha256',settingsFingerprint:'sha256',checkedAt:'value',status:'finalQualityStatus',needsReview:'value',reviewed:'value',reviewedAt:'value',findings:[{code:'finalFindingCode',severity:'reviewSeverity',startMs:'nonnegativeValue',endMs:'nonnegativeValue',durationMs:'nonnegativeValue',value:'value'}],quality:{structuralVerified:'value',observationsCompleted:'value',visualQualityCertified:'uncertified',voiceIdentityVerified:'uncertified',dialectVerified:'uncertified',lipSynchronizationVerified:'uncertified',humanReviewed:'value',decodedDurationMs:'nonnegativeValue',width:'nonnegativeValue',height:'nonnegativeValue',fps:'nonnegativeValue',hasAudio:'value'},measurements:{blackIntervals:[finalQualityInterval],freezeIntervals:[finalQualityInterval],silenceIntervals:[finalQualityInterval],peakLevelDb:'value',peakCount:'nonnegativeValue',sampleCount:'nonnegativeValue',clippingRatio:'nonnegativeValue',audioClippingStatus:'text',measuredAudioMs:'nonnegativeValue',decodedVideoMs:'nonnegativeValue'}};
const costTotals={estimatedMicroUSD:'microUSD',settledMicroUSD:'microUSD',heldMicroUSD:'microUSD',uncertainMicroUSD:'microUSD'};
const productionCosts={projectId:'id',currency:'usdCurrency',requestedDurationMs:'nonnegativeValue',actualDurationMs:'nonnegativeValue',customer:costTotals,stages:[{stageId:'stageId',kind:'text',...costTotals,resourceSeconds:'nonnegativeValue',recordedProviderUSD:'nonnegativeValue'}],planning:{settledMicroUSD:'microUSD',heldMicroUSD:'microUSD',recordedProviderUSD:'nonnegativeValue'},recordedProviderUSD:'nonnegativeValue',storageUSD:'nonnegativeValue',additionalUSD:'nonnegativeValue',computedFrom:'recordedCostSource'};
const sourceDocument={id:'id',characters:'value',sha256:'sha256',state:'text',nextChunk:'value',text:'sourceText',offset:'value'};
const customerShapes = {
    'production.source.begin':sourceDocument,'production.source.chunk':sourceDocument,'production.source.complete':sourceDocument,'production.source.get':sourceDocument,
    'production.organize':productionProject,'production.reference.attach':productionProject,'production.legacy.import':productionProject,
    'sfx.list':[soundEffectAsset],'sfx.event.approve':soundEffectBinding,
    'final.quality.get':finalQuality,'final.quality.review':finalQuality,'production.costs':productionCosts,
    'sync.face.approve':syncFace,'sync.asset.get':syncAsset,'sync.review':syncReview,'sync.timeline.get':syncTimeline,
    'director.research.quote':directorQuote,'director.research':directorCall,
    'director.source.set':directorState,
    'director.get':directorState,'director.message.quote':directorQuote,'director.message':directorCall,
    'director.plan.quote':directorQuote,'director.plan':directorCall,'director.call':directorCall,
    'director.approve':productionProject,'director.cancel':directorState,
    'production.create':productionProject,'production.get':productionProject,'production.list':[productionProject],
    'production.plan':productionProject,'production.quote':productionQuote,'production.approve':productionProject,
    'production.retry':productionProject,'production.cancel':productionProject,
    'preferences.get':{orientation:'text'},'preferences.save':{orientation:'text'},
    session: { user: { id: 'id', name: 'text' }, wallet, servers: [server], enabled: 'value', planningEnabled: 'value', capabilities: { genericEngineDefinitions:'value',legacyProduction:'value',referenceUpload: 'value', ingredients: 'value', voiceCloning: 'value', lastFrameContinuity: 'value', nativeAudio: 'value', wholeFilmMerge: 'value' } },
    'files.list': [{id:'id',projectId:'id',index:'fileIndex',kind:'text',name:'text',createdAt:'value',expiresAt:'value',bytes:'value',durationMs:'nonnegativeValue',width:'nonnegativeValue',height:'nonnegativeValue',thumbnailReady:'value'}], 'files.delete': {removed:'value'}, 'files.ticket': {url:'url',expires:'value',mime:'mediaMime'},
    wallet, 'servers.list': [server], 'rental.quote': { serverId: 'id', revision: 'value', priceMicroUSD: 'value', pricePerHourUSD: 'value', minimumCreditUSD: 'value', warning: 'text', canStart: 'value' },
    'rental.start': rental, 'rental.status': rental, 'rental.stop': rental, 'projects.list': [project],
    'project.organize':project,
    'project.preview.execute':project, 'project.preview.view':{url:'previewUrl',expires:'value'},
    'project.reference.view': { url: 'referenceUrl', expires: 'value' }, 'project.reference.ticket': { url: 'uploadUrl', expires: 'value', maxBytes: 'value' }, 'project.reference.remove': project, 'project.save': project, 'project.get': project, 'project.follow': project, 'text.status': project, 'plan.status': project, 'project.merge': project,
    'chat.submit': { accepted: 'value', textCostPolicy: 'text' }, 'plan.submit': { accepted: 'value', textCostPolicy: 'text' }, 'review.submit': { accepted: 'value', textCostPolicy: 'text' },
    'project.launch': project,
    'project.generate': { accepted: 'value' }, 'project.resume': { accepted: 'value' }, 'media.ticket': { url: 'url', expires: 'value' },
};
function safeText(value, secrets, customer) {
    let out = value;
    for (const secret of secrets)
        if (secret)
            out = out.split(secret).join('[محجوب]');
    out = out.replace(/\b(?:sk-|ak-|as-)[A-Za-z0-9_-]{8,}/g, '[محجوب]');
    // Diagnostics/paths belong in the service, never in customer display strings.
    out = out.replace(/https?:\/\/\S+|(?:[a-zA-Z]:\\|\/(?:home|srv|tmp|var)\/)[^\s]*/g, '[محجوب]');
    if (customer)
        out = out.replace(/modal|مودال/gi, 'مزود الحوسبة');
    return out;
}
function projectShape(value, shape, secrets, publicMediaOrigin) {
    if (value === null)
        return null;
    if (Array.isArray(shape))
        return Array.isArray(value) ? value.map(x => projectShape(x, shape[0], secrets, publicMediaOrigin)) : [];
    if (typeof shape === 'object') {
        if (!record(value))
            return null;
        return Object.fromEntries(Object.entries(shape).filter(([k]) => k in value).map(([k, s]) => [k, k === 'error' && !['productionError','directorError'].includes(s) && value[k] ? (value[k]==='عبّي رصيدك حتى نكمل الدردشة أو التحليل.'?'عبّي رصيدك حتى نكمل الدردشة أو التحليل.':'تعذر إكمال العملية. الناتج المنجز محفوظ؛ لم تبدأ إعادة توليد تلقائية.') : projectShape(value[k], s, secrets, publicMediaOrigin)]));
    }
    // Owner-authored source chunks are inert user data, not diagnostics. Never rewrite
    // story URLs/spacing or use the display response as a trusted execution instruction.
    if(shape==='sourceText'){if(typeof value!=='string'||value.length>12000)throw Error('INVALID_SOURCE_TEXT');let out=value;for(const secret of secrets)if(secret)out=out.split(secret).join('[محجوب]');return out;}
    if(shape==='productionPhase'){if(!['images','animation','audio','synchronization','film'].includes(value))throw Error('INVALID_PRODUCTION_PHASE');return value;}
    if(shape==='productionCompletedPhases')return Array.isArray(value)?[...new Set(value.filter(v=>v==='images'||v==='animation'||v==='audio'||v==='synchronization'))]:[];
    if(shape==='uncertified')return false;
    if(shape==='requiredApproval')return true;
    if(shape==='singleFaceCount')return value===1?1:null;
    if(shape==='nonnegativeValue')return typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
    if(shape==='microUSD')return integer(value)?value:null;
    if(shape==='usdCurrency')return value==='USD'?'USD':null;
    if(shape==='recordedCostSource')return value==='recorded_stage_receipts'?'recorded_stage_receipts':null;
    if(shape==='finalQualityStatus')return value==='reviewed'?'reviewed':'needs_review';
    if(shape==='transitionType')return value==='cut'||value==='fade'?value:null;
    if(shape==='mediaMime')return value==='image/webp'||value==='video/mp4'?value:null;
    if(shape==='reviewSeverity')return 'review';
    if(shape==='finalFindingCode')return ['BLACK_INTERVAL','FROZEN_FRAMES','AUDIO_SILENCE','AUDIO_STATS_UNAVAILABLE','AUDIO_CLIPPING_SUSPECTED','AUDIO_VIDEO_DURATION_DRIFT','SEMANTIC_QUALITY_UNVERIFIED'].includes(value)?value:'QUALITY_FINDING_UNAVAILABLE';
    if(shape==='syncReviewReasons')return Array.isArray(value)?value.slice(0,1000).map(v=>{const item=typeof v==='string'?{code:v.split(':',1)[0],subjectId:v.includes(':')?v.slice(v.indexOf(':')+1):undefined}:record(v)?v:{};return {code:syncReviewCodes.has(item.code)?item.code:'SYNC_REVIEW_REQUIRED',...(id(item.subjectId)?{subjectId:item.subjectId}:{}),...(id(item.shotId)?{shotId:item.shotId}:{})};}):[];
    if(shape==='stageId')return productionStageId(value)?value:null;
    if(shape==='sha256')return typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)?value:null;
    if(shape==='productionError')return value===null?null:typeof value==='string'&&Object.hasOwn(safeErrors,value)?value:'PRODUCTION_OPERATION_FAILED';
    if(shape==='directorError')return value===null?null:typeof value==='string'&&Object.hasOwn(safeErrors,value)?value:'DIRECTOR_OPERATION_FAILED';
    if(shape==='fileIndex')return value==='merged'||integer(value)?value:null;
    if (shape === 'value')
        return typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) ? value : null;
    if (typeof value !== 'string')
        return null;
    if (shape === 'id')
        return id(value) && !/modal|مودال/i.test(value) ? value : null;
    if(shape==='researchUrl'){try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||value.length>2048||secrets.some(s=>s&&value.includes(s))||/\b(?:sk-|ak-|as-)[A-Za-z0-9_-]{8,}/.test(value)||[...url.searchParams.keys()].some(k=>/token|secret|password|credential|api.?key/i.test(k)))return null;return url.href;}catch{return null;}}
    if(shape==='previewUrl'){const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.origin!==publicMediaOrigin||!/^\/api\/film-preview\/[A-Za-z0-9_-]+$/.test(url.pathname)||secrets.some((s,i)=>i!==1&&s&&value.includes(s)))throw Error('INVALID_MEDIA');return value;}
    if(shape==='engineTestUrl'){const url=new URL(value),keys=[...url.searchParams.keys()];if(url.protocol!=='https:'||url.username||url.password||url.hash||url.origin!==publicMediaOrigin||!/^\/api\/film-engine-test\/[A-Za-z0-9_-]{1,100}$/.test(url.pathname)||keys.length!==2||keys.some(k=>k!=='expires'&&k!=='signature')||!/^\d{1,16}$/.test(url.searchParams.get('expires')??'')||!Number.isSafeInteger(Number(url.searchParams.get('expires')))||Number(url.searchParams.get('expires'))<=0||!/^[a-f0-9]{64}$/.test(url.searchParams.get('signature')??'')||secrets.some((s,i)=>i!==1&&s&&value.includes(s)))throw Error('INVALID_MEDIA');return value;}
    if(shape==='engineTestMime')return ['image/png','image/jpeg','image/webp','video/mp4','audio/wav','audio/x-wav','application/json'].includes(value)?value:null;
    if (shape === 'referenceUrl') {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || !/^\/api\/film-reference-view\/[A-Za-z0-9_-]+$/.test(url.pathname) || url.origin !== publicMediaOrigin || secrets.some((s, i) => i !== 1 && s && value.includes(s)))
            throw Error('INVALID_UPLOAD');
        return value;
    }
    if (shape === 'uploadUrl') {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || !/^\/api\/film-reference\/[A-Za-z0-9_-]+$/.test(url.pathname) || url.origin !== publicMediaOrigin || secrets.some((s, i) => i !== 1 && s && value.includes(s)))
            throw Error('INVALID_UPLOAD');
        return value;
    }
    if (shape === 'url') {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password || !/^\/api\/film-media\/[A-Za-z0-9_-]+$/.test(url.pathname) || secrets.some((s, i) => i !== 1 && s && value.includes(s)))
            throw Error('INVALID_MEDIA');
        return value; // Opaque signature bytes must stay intact.
    }
    return safeText(value, secrets, true);
}
// Administrator DTO keys are also allowlisted. Credentials and raw exception/trace fields have no entry.
const adminKeys = new Set(('id label name workspace role mode volume createdAt updatedAt activated discovery ready checkedAt files size present hasHF billing capacity weightsReady slots activeCount accountId gpu cpu ram hourMicros published locked revision settings testJobId visualAudioReviewedAt reviewedQualityContract maxConcurrent source remainingMicroUSD expiresAt renewsAt customerId wallet balanceMicroUSD reservedMicroUSD activeRentalId lots amountMicroUSD expired remaining amount email serverId state elapsedSeconds billedMicroUSD hourPriceUSD lowFunds phase completed total stopReason message providerRecordedUSD uncoveredMicroUSD estimatedSupplierUSD supplierCostSource type acknowledged configured model savedAt pricing maximumOutputTokens monthlyLimitUSD note inputPerMillionUSD outputPerMillionUSD saved updated requested verified unlinked removed action sourceId estimate rate resourceWindowUSD maximumUSD minimumUSD costUSD cpuUSD gpuUSD ramUSD storageUSD startupSeconds budget timeout startup idleSeconds quality contract nativeAudio seconds width height plan transport steps warning expiresAt consumed paidEnabled requiresExplicitApproval quoteId jobId status cloudStopped startedAt finishedAt events kind global_completed global_total result videoVerified generationSucceeded recordedCost usd sha256 elapsedSeconds probeVerified verificationOnly gpuUsed transferredBytes cloud_stopped cleanup stoppedAt readyAt progress endpoint credentialFields tokenIdLabel tokenSecretLabel keyLabel creditBalanceUSD creditRenewalAt subscriptionExpiresAt availability renewalAt').split(' '));
for (const key of ('ramLimit orientation seed expectedSeconds windowSeconds manualControl recordedUSD url checked storageGiBMonth profile nativeWidth nativeHeight output pipeline videoDecoder textQualityRequired fps frames convVAE offload fp8 inputUSDPerMillion outputUSDPerMillion inputPerMillion outputPerMillion requiredBytes sourceVolume destinationVolume modelRepo modelRevision licenseAccepted localStagingAvailableBytes localStagingRequiredBytes localStagingReady blockingReason resume storageUSDPerMonth storageNote integrityReadBytes networkCostUSD buildCostUSD workerReady executionReady workerApp cpuSettings cpuEstimate missingCorruptFiles productionQuality manifestMatch valid').split(' '))
    adminKeys.add(key);
for (const key of ('manifestId manifestFingerprint workerFingerprint transferPlanFingerprint sourceIntegrityReadBytes destinationIntegrityReadBytes totalIntegrityReadBytes usesHostDisk mode verificationStrategy destinationVerifierMayDeploy orchestration sourceCpuCalls totalWindowSeconds sourceWindowSeconds destination calls ramGiB timeoutSeconds startupSeconds idleSeconds windowSeconds gpuUsed networkListReferenceUSD compute billingWorkspace').split(' '))
    adminKeys.add(key);
for (const key of ('confirmed pending jobs rentals standaloneActiveCount').split(' '))
    adminKeys.add(key);
for (const key of ('retired retiredAt unlinked unlinkedAt remoteResourcesDeleted providerTokenRevoked').split(' '))
    adminKeys.add(key);
for(const key of ['expectedBytes','missingBytes','fileCount','missingFiles','softwareInstalled','preparation','networkUSD','buildUSD','completedBytes','totalBytes','filesCompleted','totalFiles','variant','sourceURL','sourceVerification','resources','recommendedCPU','recommendedRAMGiB','recommendedVRAMGiB','verification','modelName','weightPath','preparationState','deploymentState','runtime','estimatedCustomerUSD','recordedProviderUSD','requiresReconcile','blockers','settingsRevision','customerRateUSD','dispatchAvailable','modelId','version','enabled','adapterAvailable','minVramGiB','supportedGPUs','models','engines','engine','engineId','requiresPreparation','lastError','capabilities','available','canStart','canPrepare','blocked','reasonCode','inspectedAt','configuration','adapter','prepareJobId','transferred','required','file','unit','verifiedFiles','estimatedUSD','eta','sequence','receivedAt','error','error_type','app_id','running_containers','tasks','testingOnly','trialPublishedAt'])adminKeys.add(key);
for(const key of ['workflowState','softwareVersion','modelRevision','dependencies','pins','license','allowed','identifier','runtimeProfile','ramGiB','latestTest','testId','requestId','projectId','stageId','filesReady','environmentReady','testCurrent','approval','publication','approved','tested','accepted','reviewed','publishedAt','artifacts','mime','bytes','durationMs','estimatedMicroUSD','needsInputs','custody','artifactId'])adminKeys.add(key);
function adminDTO(value, secrets, depth = 0) {
    if (record(value) && typeof value.reason === 'string' && typeof value.subject === 'string' && 'acknowledged' in value) {
        const d = record(value.details) ? value.details : {};
        return { id: id(value.id) ? value.id : null, reason: safeText(value.reason, secrets, false), subject: safeText(value.subject, secrets, false), createdAt: integer(value.createdAt) ? value.createdAt : null, acknowledged: value.acknowledged === true, details: { ...(typeof d.knownReason === 'string' ? { knownReason: safeText(d.knownReason, secrets, false) } : {}), ...(id(d.accountId) ? { accountId: d.accountId } : {}), ...(d.source === 'administrator' ? { source: 'administrator' } : {}), ...(date(d.expiresAt) ? { expiresAt: d.expiresAt } : {}) } };
    }
    if (depth > 15)
        return null;
    if (Array.isArray(value))
        return value.map(x => adminDTO(x, secrets, depth + 1));
    if (record(value))
        return Object.fromEntries(Object.entries(value).filter(([k]) => adminKeys.has(k) && k !== 'endpoint').map(([k, v]) => [k, adminDTO(v, secrets, depth + 1)]));
    if (typeof value === 'string')
        return safeText(value, secrets, false);
    return typeof value === 'boolean' || typeof value === 'number' || value === null ? value : null;
}
const safeErrors = {
    INVALID_ENGINE_TEST_INPUT:'راجع وصف الاختبار والمراجع المختارة؛ لم يبدأ تشغيل.',
    ENGINE_TEST_RUNNER_UNAVAILABLE:'مسار الاختبار الحقيقي غير متاح لهذا المحرك بعد.',
    ENGINE_TEST_PROJECT_REQUIRED:'أنشئ مشروع اختبار إداري خاص بهذا الحساب أولاً.',
    ENGINE_TEST_STAGE_REQUIRED:'حدد مرحلة اختبار متوافقة مع النموذج.',
    ENGINE_TEST_REFERENCE_REQUIRED:'الاختبار يحتاج صورة مرجعية معتمدة تخص مشروع الأدمن.',
    ENGINE_TEST_VOICE_REQUIRED:'اختر ملف صوت معتمداً ومتوافقاً مع اللهجة والموديل.',
    ENGINE_TEST_REVIEWED_SYNC_INPUT_REQUIRED:'مزامنة الشفاه تحتاج فيديو وصوتاً ومحاذاة ووجهاً معتمدة قبل الاختبار.',
    ENGINE_TEST_DURATION_EXCEEDED:'مدة عينة الاختبار تتجاوز الحد القصير المعتمد.',
    ENGINE_TEST_INPUT_UNVERIFIED:'تعذر التحقق من مدخلات الاختبار؛ لم يبدأ تشغيل بديل.',
    ENGINE_TEST_UNAVAILABLE:'الاختبار غير متاح؛ أكمل تجهيز البيئة والمراجع.',
    ENGINE_TEST_ESTIMATE_UNAVAILABLE:'تقدير الاختبار غير متاح؛ لا تشغيل دون عرض تكلفة.',
    ENGINE_TEST_QUOTE_EXPIRED:'انتهى عرض الاختبار؛ اطلب عرضاً جديداً قبل الموافقة.',
    ENGINE_TEST_NOT_READY:'أكمل فحص الملفات والبيئة والترخيص قبل الاختبار.',
    ENGINE_TEST_OUTPUT_UNVERIFIED:'تعذر توثيق ناتج الاختبار؛ لا يُعتمد أو ينشر تلقائياً.',
    ENGINE_TEST_FAILED:'فشل الاختبار. راجع النتيجة المحفوظة قبل أي محاولة جديدة.',
    ENGINE_TEST_STATE_UNKNOWN:'حالة الاختبار غير محسومة؛ تابع نفس الطلب دون إعادة تشغيل.',
    ENGINE_TEST_REVIEW_REQUIRED:'راجع ناتج الاختبار الموثق قبل اعتماده.',
    ENGINE_TEST_REJECTED:'لم تُقبل نتيجة الاختبار؛ لم يُنشر المحرك.',
    ENGINE_TEST_APPROVAL_BLOCKED:'اعتماد المحرك يتطلب اختباراً ناجحاً ومراجعة ومتطلبات مكتملة.',
    ENGINE_TEST_STALE:'الاختبار لا يطابق آخر نسخة من المحرك؛ راجع النسخة الحالية.',
    ENGINE_PUBLICATION_BLOCKED:'المحرك غير قابل للنشر قبل اعتماد الاختبار والترخيص والبيئة.',
    ENGINE_LICENSE_REQUIRED:'ترخيص الاستخدام المقصود غير معتمد لهذا المحرك.',
    ENGINE_ENVIRONMENT_UNVERIFIED:'إصدار البيئة أو التبعيات غير متحقق؛ لا اختبار أو نشر.',
    ENGINE_DEPENDENCIES_UNVERIFIED:'متطلبات المحرك أو إصداراتها غير مكتملة.',
    LATENTSYNC_COMMERCIAL_RIGHTS_REQUIRED:'حقوق مكونات الوجه التجارية غير محسومة؛ مزامنة الشفاه غير متاحة للنشر التجاري.',
    HUNYUAN_LICENSE_ACKNOWLEDGEMENT_REQUIRED:'يلزم اعتماد شروط ترخيص الفيديو ونطاق استخدامه أولاً.',
    SPEECH_CODEC_AUTHORIZATION_REQUIRED:'يلزم إعداد تفويض Hugging Face لمكوّن فك الصوت؛ لم يكتمل التجهيز.',
    SPEECH_COMPONENT_ACCESS_DENIED:'مكوّن الصوت يتطلب قبول شروط الناشر أو صلاحية وصول؛ وجود المفتاح وحده لا يكفي.',
    SPEECH_COMPONENT_NOT_FOUND:'تعذّر التحقق من الملف الصوتي وإصداره المحدد؛ المحرك غير جاهز.',
    SPEECH_COMPONENT_ACCESS_UNAVAILABLE:'تعذّر فحص الوصول لمكوّن الصوت حالياً؛ لا إعادة مدفوعة تلقائية.',
    SPEECH_LICENSE_ACKNOWLEDGEMENT_REQUIRED:'يلزم اعتماد ترخيص الصوت ومكوّناته قبل الاختبار والنشر.',
    DIRECTOR_REFERENCE_LOCKED:'الصورة مرتبطة بخطة معتمدة أو إنتاج جارٍ؛ احتفظنا بالأصل دون تشغيل جديد.',
    INVALID_PRODUCTION_SOURCE:'راجع حجم القصة وأجزاء الرفع؛ لم يُفقد النص الأصلي.',
    PRODUCTION_SOURCE_INCOMPLETE:'لم يكتمل رفع القصة بعد؛ أكمل الأجزاء قبل التخطيط.',
    PRODUCTION_SOURCE_CHANGED:'تغيّرت أجزاء القصة عن بصمتها المحفوظة؛ لم يبدأ إنتاج.',
    DIRECTOR_SOURCE_SUMMARIES_REQUIRED:'القصة طويلة؛ أكمل قراءة فصولها وحفظ ملخصاتها قبل تخطيط الفيلم.',
    DIRECTOR_SOURCE_WINDOW_TOO_LONG:'هذا الجزء أكبر من نافذة التخطيط الآمنة؛ قسّمه قبل إرسال طلب جديد.',
    PRODUCTION_SPEND_LIMIT_REQUIRED:'راجع عرض التكلفة وحدد الحد الأعلى للإنفاق قبل الموافقة.',
    PRODUCTION_MODEL_NOT_PUBLISHED:'أحد المحركات غير معتمد أو غير منشور للزبائن بعد؛ لم يبدأ تشغيل.',
    PRODUCTION_METER_OVERFLOW:'تعذر جمع مبالغ الإنتاج بأمان؛ راجع السجلات المالية دون بدء طلب مدفوع جديد.',
    FINAL_QUALITY_REVIEW_REQUIRED:'الفيلم النهائي يحتاج مراجعة للصوت والصورة قبل اعتماده؛ لا يعاد التوليد تلقائياً.',
    FINAL_QUALITY_INVALID_INPUT:'راجع مدة الفيلم وأبعاده وبيانات فحصه قبل المتابعة.',
    FINAL_QUALITY_SCOPE_CHANGED:'فحص الجودة لا يطابق نسخة الفيلم الحالية؛ راجع النتيجة المرتبطة بها.',
    FINAL_QUALITY_SOURCE_CHANGED:'تغير ملف الفيلم بعد فحصه؛ لا يُعتمد الفحص القديم تلقائياً.',
    FINAL_QUALITY_INVALID_OBSERVATIONS:'تعذر اعتماد قياسات الجودة بأمان؛ الفيلم الأصلي محفوظ.',
    FINAL_QUALITY_DECODE_FAILED:'تعذر فكّ ترميز الفيلم للفحص؛ الأصل محفوظ ولم يبدأ توليد بديل.',
    FINAL_QUALITY_TOOL_UNAVAILABLE:'أداة فحص الفيلم غير متاحة على الخادم حالياً.',
    FINAL_QUALITY_DIMENSION_MISMATCH:'أبعاد الفيلم لا تطابق الخطة المعتمدة؛ راجع الدمج.',
    FINAL_QUALITY_VERIFIER_MISMATCH:'نتائج فحص بنية الفيلم غير متوافقة؛ يلزم مراجعتها.',
    FINAL_QUALITY_VIDEO_INVALID:'تعذر التحقق من ملف الفيلم النهائي؛ الأصل محفوظ للمراجعة.',
    SFX_LICENSE_REQUIRED:'المؤثر يحتاج مصدراً وترخيصاً أو حق استخدام معتمداً قبل إضافته.',
    SFX_SOURCE_REQUIRED:'حدد مصدر المؤثر الصوتي المرخص؛ لا تنزيل تلقائي من الإنترنت.',
    SFX_ASSET_REQUIRED:'أضف ملف المؤثر المعتمد أولاً؛ لم يبدأ توليد صوت بديل.',
    SFX_ASSET_NOT_APPROVED:'ملف المؤثر غير معتمد للاستخدام في هذا الفيلم.',
    SFX_ASSET_NOT_LICENSED_OR_OWNED:'المؤثر لا يخص هذا الحساب أو لم يُعتمد حق استخدامه.',
    SFX_ASSET_CHANGED:'تغير ملف المؤثر عن الأصل المسجل؛ راجع الملف قبل الدمج.',
    SFX_EVENT_REVIEW_REQUIRED:'حدد لحظة الحدث في الفيديو الفعلي وراجع توقيت المؤثر.',
    SFX_VISUAL_SOURCE_REQUIRED:'أكمل فيديو الحدث المعتمد قبل ربط المؤثر بتوقيته.',
    SFX_VISUAL_SOURCE_CHANGED:'تغير فيديو الحدث؛ راجع ربط المؤثر بلحظته الجديدة.',
    SFX_TIMING_OUT_OF_BOUNDS:'توقيت المؤثر يتجاوز مدة اللقطة الفعلية؛ راجع بدايته ونهايته.',
    SFX_INVALID_TIMELINE:'توقيت المؤثرات لا يطابق خط الفيلم الزمني.',
    SFX_SOURCE_TOO_SHORT:'ملف المؤثر أقصر من المدة المطلوبة؛ لا يكرر أو يتمدد تلقائياً.',
    SFX_MUSIC_APPROVAL_REQUIRED:'الموسيقى اختيارية وتحتاج طلباً صريحاً قبل إضافتها.',
    SFX_CATEGORY_MISMATCH:'نوع المؤثر لا يطابق الملف المعتمد؛ اختر مؤثراً مناسباً.',
    SFX_SILENCE_TIMING_REVIEW_REQUIRED:'راجع فترة الصمت المقصودة في التوقيت المقاس للفيلم.',
    SFX_SILENCE_WOULD_CUT_SPEECH:'فترة الصمت المقترحة تقطع الكلام؛ راجع التوقيت دون قص الصوت الأصلي.',
    SFX_GENERATION_ADAPTER_UNAVAILABLE:'توليد مؤثر جديد غير مفعّل؛ استخدم ملفاً مرخصاً من المكتبة.',
    SFX_IDEMPOTENCY_CONFLICT:'للمؤثر سجل مختلف بالمعرف نفسه؛ لم يبدأ طلب بديل.',
    SFX_INVALID_INPUT:'راجع بيانات المؤثر وتوقيته وحق استخدامه.',
    SFX_FORBIDDEN:'هذا المؤثر غير متاح لهذا الحساب أو لا تملك صلاحية اعتماده.',
    SFX_STORE_REQUIRED:'تخزين المؤثرات غير متاح حالياً؛ لم تبدأ معالجة جديدة.',
    PRODUCTION_SYNC_NEEDS_REVIEW:'المزامنة تحتاج مراجعة للصوت أو الوجه أو مدة اللقطة. النتائج محفوظة؛ لا تشغيل أو إعادة مدفوعة تلقائياً.',
    SYNC_FACE_REVIEW_REQUIRED:'حدد الوجه الواحد المقصود والمتحدث الصحيح وراجعه قبل مزامنة الشفاه.',
    SYNC_FACE_BINDING_CHANGED:'تغيّر فيديو الوجه المعتمد؛ راجع ربط الشخصية باللقطة من جديد.',
    SYNC_FACE_BINDING_IMMUTABLE:'الوجه مرتبط بشخصية معتمدة أخرى؛ لا يُبدّل المتحدث تلقائياً.',
    SYNC_ALIGNMENT_INVALID:'توقيت المحاذاة غير صالح؛ راجع نتيجة الصوت دون إعادة توليده تلقائياً.',
    SYNC_ALIGNMENT_TEXT_MISMATCH:'نص المحاذاة لا يطابق الحوار المعتمد؛ راجع الكلمات والمتحدث.',
    SYNC_ALIGNMENT_SCOPE_INVALID:'المحاذاة لا تطابق صوت الشخصية أو اللقطة المعتمدة.',
    SYNC_ALIGNMENT_MERGE_INVALID:'ترتيب أجزاء المحاذاة لا يطابق الصوت الأصلي؛ النتائج محفوظة للمراجعة.',
    SYNC_REVIEW_REQUIRED:'راجع نتيجة المزامنة صراحةً قبل اعتمادها؛ نجاح المعالجة لا يثبت جودة الشفاه أو الوجه.',
    SYNC_FORBIDDEN:'هذه النتيجة غير متاحة لهذا الحساب أو لا تملك صلاحية مراجعتها.',
    SYNC_ASSET_CHANGED:'تغيّر ملف المزامنة عن النسخة المسجلة؛ راجع سلامة الملف الأصلي.',
    SYNC_ASSET_CONFLICT:'للعملية نتيجة محفوظة مختلفة؛ لم يبدأ طلب بديل.',
    SYNC_ATTEMPT_NOT_ACTIVE:'مرحلة المزامنة ليست قيد التنفيذ؛ حدّث حالتها دون تكرار التشغيل.',
    SYNC_SOURCE_REQUIRED:'أكمل الصوت والفيديو الأصليين المعتمدين قبل المزامنة.',
    SYNC_UNSAFE_PATH:'تعذر قراءة ملف المزامنة بأمان؛ راجع إدارة التخزين.',
    SYNC_VIDEO_NORMALIZATION_FAILED:'تعذر تجهيز فيديو المزامنة بالصيغة المطلوبة؛ الأصل محفوظ.',
    SYNC_VIDEO_NORMALIZER_REQUIRED:'أدوات تجهيز فيديو المزامنة غير متاحة حالياً؛ لم يبدأ تشغيل بديل.',
    SYNC_VIDEO_SCOPE_INVALID:'فيديو المزامنة لا يطابق الشخصية أو الصوت المعتمد.',
    SYNC_VIDEO_SETTINGS_MISMATCH:'أبعاد أو توقيت فيديو المزامنة لا يطابق الإعدادات المعتمدة.',
    CINEMATIC_TIMELINE_REVIEW_REQUIRED:'التوقيت السينمائي يحتاج مراجعة قبل الدمج؛ لا تمديد أو توليد تلقائي.',
    CINEMATIC_ALIGNMENT_REVIEW_REQUIRED:'محاذاة الكلام منخفضة الثقة أو غير مكتملة؛ راجع توقيتها الفعلي.',
    CINEMATIC_DEPENDENCY_REVIEW_REQUIRED:'أكمل مراجعة مصادر الصوت والفيديو قبل متابعة المزامنة.',
    CINEMATIC_LIP_OUTPUT_REVIEW_REQUIRED:'راجع فيديو الشفاه وثبات الوجه قبل الدمج النهائي.',
    CINEMATIC_SPEAKER_REVIEW_REQUIRED:'تعذر تحديد المتحدث المقصود بأمان؛ راجع الشخصية والوجه.',
    CINEMATIC_VISUAL_COVERAGE_REQUIRED:'الصوت أطول من الصور المتاحة؛ يلزم تخطيط تغطية بصرية إضافية وموافقة منفصلة.',
    CINEMATIC_WORD_CUT_REVIEW_REQUIRED:'حد اللقطة قد يقطع كلام الشخصية؛ راجع توقيت المحاذاة.',
    CINEMATIC_AUDIO_IDENTITY_MISMATCH:'الصوت لا يطابق ملف المتحدث المعتمد؛ لا يُستبدل الصوت تلقائياً.',
    CINEMATIC_AUDIO_METADATA_INVALID:'بيانات مدة الصوت أو عيناته غير متوافقة؛ راجع الملف الأصلي.',
    CINEMATIC_VIDEO_METADATA_INVALID:'بيانات مدة الفيديو غير سليمة؛ راجع اللقطة الأصلية.',
    CINEMATIC_ALIGNMENT_SCOPE_MISMATCH:'المحاذاة لا تخص المتحدث أو الصوت الحاليين.',
    CINEMATIC_ALIGNMENT_MERGE_INVALID:'أجزاء المحاذاة لا تطابق ترتيب الصوت الأصلي.',
    CINEMATIC_ASSET_SCOPE_MISMATCH:'أحد الملفات لا يخص مشروع الفيلم الحالي.',
    CINEMATIC_ATTEMPT_NOT_ACTIVE:'طلب المزامنة ليس في حالة تنفيذ؛ تابع حالته المحفوظة.',
    CINEMATIC_AUDIO_FORMAT_CHANGED:'صيغة الصوت تغيرت عن الأصل المعتمد؛ راجع الملف دون تسريعه أو قصه.',
    CINEMATIC_VIDEO_FORMAT_CHANGED:'صيغة الفيديو تغيرت عن الأصل المعتمد؛ راجع تجهيز اللقطة.',
    CINEMATIC_AUDIO_WINDOW_INVALID:'نافذة صوت الشخصية لا تطابق توقيت اللقطة؛ راجع المحاذاة.',
    CINEMATIC_CUE_AMBIGUOUS:'توجد إشارتا توقيت متعارضتان للقطة؛ حدد الكلمة أو الجملة المقصودة.',
    CINEMATIC_CUE_INVALID:'إشارة انتقال الصورة لا تطابق كلمة أو جملة محاذاة معتمدة.',
    CINEMATIC_PLAN_ORDER_INVALID:'ترتيب لقطات الفيلم وتوقيتها غير متوافق؛ راجع المخطط.',
    CINEMATIC_UTTERANCE_INVALID:'توقيت الحوار أو هوية المتحدث غير صالحين للمزامنة.',
    CINEMATIC_TIMELINE_INPUT_INVALID:'راجع ملفات الصوت والفيديو وتوقيت الخطة قبل المزامنة.',
    CINEMATIC_TIMELINE_DUPLICATE_OR_INVALID_ID:'توجد مراجع مكررة أو غير سليمة في خطة المزامنة.',
    CINEMATIC_ALIGNMENT_TOO_LARGE:'بيانات محاذاة هذا الطلب كبيرة؛ راجع تقسيم الفصل.',
    CINEMATIC_FFMPEG_UNAVAILABLE:'أداة تجهيز ودمج الوسائط غير متاحة على الخادم حالياً.',
    CINEMATIC_FFMPEG_FAILED:'تعذر تجهيز أو دمج الوسائط؛ الملفات الأصلية محفوظة ولم يبدأ توليد جديد.',
    CINEMATIC_OUTPUT_INVALID:'تعذر التحقق من ملف المزامنة الناتج؛ الأصل محفوظ للمراجعة.',
    DIRECTOR_EDIT_INVALID:'تعذر تحديد نطاق التعديل؛ وضّح الجزء المطلوب تغييره.',
    DIRECTOR_EDIT_OUTLINE_REQUIRED:'أكمل مخطط القصة قبل تعديل مشهد أو شخصية.',
    DIRECTOR_EDIT_NUMBER_INVALID:'راجع رقم المشهد أو اللقطة المطلوبة.',
    DIRECTOR_EDIT_TARGET_ID_REQUIRED:'حدد الشخصية أو الراوي المطلوب تعديله.',
    DIRECTOR_EDIT_TARGET_REQUIRED:'حدد المشهد أو الشخصية المطلوب تعديلها.',
    DIRECTOR_EDIT_TARGET_UNAVAILABLE:'الجزء المطلوب غير موجود ضمن الخطة المكتملة حالياً.',
    DIRECTOR_EDIT_AMBIGUOUS:'التعديل يحتمل أكثر من هدف؛ وضح الجزء المطلوب.',
    DIRECTOR_RESEARCH_NOT_NEEDED:'لم يُطلب بحث لهذه المناقشة؛ يمكنك طلب بحث محدد صراحةً.',
    DIRECTOR_RESEARCH_QUERY_INVALID:'حدد موضوع بحث واضحاً ضمن الحد المسموح.',
    DIRECTOR_RESEARCH_DOMAINS_INVALID:'راجع المصادر المسموحة للبحث.',
    DIRECTOR_RESEARCH_LIMIT_INVALID:'راجع حدود البحث والتوكنات قبل الموافقة.',
    DIRECTOR_RESEARCH_EXPANSION_APPROVAL_REQUIRED:'توسيع البحث يحتاج عرض كلفة وموافقة صريحة.',
    DIRECTOR_RESEARCH_SOURCE_INVALID:'تعذر اعتماد أحد روابط البحث بأمان.',
    DIRECTOR_RESEARCH_OUTPUT_INVALID:'تعذر اعتماد نتيجة البحث؛ النص الأصلي محفوظ ولم يبدأ بحث بديل.',
    DIRECTOR_RESEARCH_EVIDENCE_INVALID:'أدلة البحث غير مكتملة؛ لا تُعرض الادعاءات بوصفها مؤكدة.',
    DIRECTOR_RESEARCH_SOURCE_UNOBSERVED:'لم يُرصد المصدر في أدلة البحث؛ لم يُعتمد الاستشهاد.',
    DIRECTOR_RESEARCH_REQUEST_INVALID:'راجع حقول طلب البحث.',
    DIRECTOR_RESEARCH_REQUEST_CONFLICT:'معرّف البحث مستخدم ببيانات أخرى؛ لم يبدأ طلب بديل.',
    DIRECTOR_ORIENTATION_REQUIRED:'حدد الاتجاه العمودي أو الأفقي قبل اعتماد خطة الفيلم.',
    DIRECTOR_OUTLINE_REQUIRED:'أكمل مخطط الفصول قبل تخطيط المشاهد.',
    DIRECTOR_SCENE_INVALID:'تخطيط المشهد لا يطابق الفصل المعتمد؛ النص الأصلي محفوظ.',
    DIRECTOR_SOURCE_CHANGED:'تغيّر مصدر القصة؛ راجع النسخة الحالية قبل التخطيط.',
    DIRECTOR_TIMELINE_INVALID:'توقيت الخطة غير مكتمل أو متعارض؛ النص الأصلي محفوظ.',
    DIRECTOR_VOICE_CHANGED:'تغيّرت هوية الصوت؛ اعتمد ملف الصوت المطلوب صراحةً قبل المتابعة.',
    DIRECTOR_REVISION_SCOPE_INVALID:'التعديل يتجاوز الجزء المحدد؛ لم تتغير بقية الخطة.',
    DIRECTOR_OPERATION_DISABLED:'تنفيذ طلبات المخرج غير مفعّل حالياً.',
    DIRECTOR_CALL_NOT_FOUND:'طلب المخرج غير موجود أو لا يخص حسابك.',
    DIRECTOR_NOT_FOUND:'الفيلم أو خطة المخرج غير موجودة أو غير متاحة لحسابك.',
    DIRECTOR_OPERATION_FAILED:'تعذر إكمال طلب المخرج بأمان؛ لم تبدأ إعادة تلقائية.',
    DIRECTOR_DISABLED:'المخرج الذكي غير مفعّل حالياً؛ لم يبدأ طلب مدفوع.',
    DIRECTOR_BUSY:'المخرج يتابع طلباً جارياً؛ انتظر نتيجته دون تكراره.',
    DIRECTOR_QUOTE_REQUIRED:'راجع كلفة التخطيط ووافق عليها قبل إرسال الطلب.',
    DIRECTOR_QUOTE_EXPIRED:'انتهت صلاحية عرض التخطيط؛ اطلب عرضاً جديداً.',
    DIRECTOR_QUOTE_CHANGED:'تغيّر سياق الفيلم أو إعداداته؛ راجع عرضاً جديداً.',
    DIRECTOR_APPROVAL_REQUIRED:'راجع القصة والخطة واعتمدها قبل الإنتاج.',
    DIRECTOR_REVISION_REQUIRED:'اختر نسخة خطة مكتملة قبل الاعتماد.',
    DIRECTOR_REVISION_STALE:'تغيرت الخطة منذ إعداد هذا التعديل؛ راجع نسختها الحالية.',
    DIRECTOR_STAGE_REQUIRED:'أكمل مرحلة التخطيط السابقة أولاً.',
    DIRECTOR_PLAN_INCOMPLETE:'خطة الفيلم غير مكتملة؛ أكمل الفصول المطلوبة.',
    DIRECTOR_STATE_UNKNOWN:'حالة طلب المخرج غير مؤكدة؛ تابع نفس الطلب دون إعادة مدفوعة.',
    DIRECTOR_CANCELLED:'أُلغي طلب المخرج؛ لم يبدأ طلب بديل.',
    DIRECTOR_INVALID_INPUT:'راجع حقول طلب المخرج.',
    INVALID_DIRECTOR_REQUEST:'راجع حقول طلب المخرج.',
    INVALID_DIRECTOR_RESPONSE:'تعذر اعتماد مخرجات المخرج؛ النص الأصلي محفوظ.',
    DIRECTOR_CONTEXT_TOO_LONG:'سياق هذا الطلب طويل؛ استخدم تخطيط الفصول على مراحل.',
    OPENAI_KEY_INVALID:'تعذر تفويض خدمة المخرج؛ راجع الإدارة.',
    OPENAI_ACCESS_DENIED:'خدمة المخرج غير متاحة لهذا التفويض؛ راجع الإدارة.',
    OPENAI_MODEL_UNAVAILABLE:'نموذج المخرج المحدد غير متاح؛ راجع الإدارة.',
    OPENAI_RATE_OR_CREDIT_LIMIT:'وصلت الخدمة إلى حد الطلبات أو الرصيد؛ راجع الإدارة.',
    OPENAI_REQUEST_FAILED:'تعذر إتمام طلب المخرج؛ لم تبدأ إعادة تلقائية.',
    OPENAI_CONNECTION_UNCERTAIN_NO_RETRY:'تعذر تأكيد نتيجة طلب المخرج؛ تابع نفس الطلب دون إعادة مدفوعة.',
    OPENAI_INCOMPLETE_OUTPUT_NO_RETRY:'لم يكتمل رد المخرج؛ النص الأصلي محفوظ ولم تبدأ إعادة تلقائية.',
    OPENAI_EMPTY_OR_REFUSED:'تعذر إتمام هذا الطلب؛ النص الأصلي محفوظ.',
    TEXT_COST_APPROVAL_REQUIRED:'وافق على كلفة النص قبل إرسال طلب المخرج.',
    TEXT_REQUEST_ID_CONFLICT:'معرّف الطلب مستخدم ببيانات أخرى؛ لم يُرسل طلب بديل.',
    PRODUCTION_EXECUTION_DISABLED:'تنفيذ الإنتاج غير مفعّل؛ لم يبدأ تشغيل مدفوع.',
    PRODUCTION_NOT_PLANNED:'أكمل خطة الإنتاج أولاً.',
    PRODUCTION_CONFIG_CHANGED:'تغيرت إعدادات الإنتاج؛ اطلب عرضاً جديداً قبل التشغيل.',
    PRODUCTION_RETRY_REQUIRED:'المرحلة تحتاج طلب إعادة محاولة صريحاً بعرض جديد.',
    PRODUCTION_RETRY_UNSAFE:'لا يمكن إعادة المحاولة قبل التأكد من حالة الطلب السابق.',
    PRODUCTION_STAGE_FAILED:'تعذر إكمال مرحلة الإنتاج؛ الناتج المنجز محفوظ ولم تبدأ إعادة تلقائية.',
    REFERENCE_NOT_OWNED:'الصورة المرجعية غير موجودة أو لا تخص حسابك.',
    PRODUCTION_PLANNING_FAILED:'تعذر إعداد خطة الإنتاج؛ لم يبدأ توليد جديد.',
    PRODUCTION_ESTIMATE_UNAVAILABLE:'تقدير كلفة المرحلة غير متاح؛ لم يبدأ تشغيل مدفوع.',
    PRODUCTION_MODEL_NOT_READY:'نموذج مرحلة الإنتاج غير جاهز؛ لم يبدأ تشغيل مدفوع.',
    PRODUCTION_ARTIFACT_UNAVAILABLE:'ملف مرحلة الإنتاج غير متاح؛ لا يعاد توليده تلقائياً.',

    PRODUCTION_OPERATION_FAILED:'تعذر إكمال مرحلة الإنتاج بأمان؛ تابع نفس الطلب دون إعادة تلقائية.',
    PRODUCTION_PLANNER_UNAVAILABLE:'مخطط الإنتاج غير مهيأ بعد؛ لم يبدأ طلب ذكاء اصطناعي أو GPU.',
    PRODUCTION_ADAPTER_UNAVAILABLE:'محوّل مرحلة الإنتاج غير مثبت؛ لم يبدأ تشغيل مدفوع.',
    PRODUCTION_APPROVAL_REQUIRED:'راجع خطة الإنتاج وكلفتها ووافق عليها قبل التشغيل.',
    PRODUCTION_QUOTE_EXPIRED:'انتهى عرض الإنتاج؛ اطلب عرضاً جديداً.',
    PRODUCTION_QUOTE_CHANGED:'تغيرت خطة الإنتاج أو كلفتها؛ راجع عرضاً جديداً.',
    PRODUCTION_QUOTE_ALREADY_USED:'عرض الإنتاج مستخدم؛ تابع الطلب المحفوظ ولا تكرر التشغيل.',
    PRODUCTION_PLAN_REQUIRED:'أكمل تخطيط الإنتاج قبل طلب التشغيل.',
    PRODUCTION_STAGE_NOT_RETRYABLE:'المرحلة لا تقبل إعادة المحاولة بهذه الحالة.',
    PRODUCTION_INSUFFICIENT_CREDIT:'رصيدك لا يكفي لهذه المرحلة؛ اشحن المحفظة أولاً.',
    PRODUCTION_OUTSTANDING_BALANCE:'توجد كلفة سابقة تحتاج تسوية؛ راجع الإدارة قبل تشغيل جديد.',
    PRODUCTION_STATE_UNKNOWN:'حالة مرحلة الإنتاج غير مؤكدة؛ تابع نفس الطلب دون تكراره.',
    PRODUCTION_CANCELLED:'أُلغي طلب الإنتاج؛ لم يبدأ تشغيل بديل.',
    PRODUCTION_BUSY:'الإنتاج قيد التنفيذ؛ تابع حالته أولاً.',
    INVALID_PRODUCTION_INPUT:'راجع حقول طلب الإنتاج.',

    ENGINE_NOT_READY:'المحرك غير جاهز؛ أكمل الفحص والتجهيز المعتمد أولاً.',
    ENGINE_MANIFEST_REQUIRED:'ملفات النموذج غير معرّفة؛ لم يبدأ نقل أو تشغيل.',
    ENGINE_CONFIG_CHANGED:'تغيرت إعدادات المحرك؛ راجع عرضاً جديداً قبل التشغيل.',
    ENGINE_APPROVAL_REQUIRED:'راجع عرض الكلفة ووافق عليه قبل بدء التشغيل.',
    ENGINE_STATE_UNKNOWN:'حالة المورد غير مؤكدة؛ تابع نفس العملية ولا تبدأ بديلاً تلقائياً.',
    INVALID_ENGINE_CONFIG:'راجع إعدادات المحرك؛ لم يبدأ تشغيل.',
    ENGINE_OPERATION_FAILED:'تعذر إكمال عملية المحرك بأمان؛ تابع حالتها دون إعادة تلقائية.',
    ENGINE_NOT_CONFIGURED:'المحرك غير مهيأ؛ لم يبدأ تشغيل GPU أو نقل أوزان.',
    ENGINE_ADAPTER_UNAVAILABLE:'محوّل المحرك غير مثبت بعد؛ لم يبدأ تشغيل مدفوع.',
    MODEL_NOT_CONFIGURED:'النموذج غير مهيأ بعد؛ لم يبدأ تشغيل مدفوع.',
    MODEL_ADAPTER_UNAVAILABLE:'محوّل النموذج غير متاح؛ لم يبدأ تشغيل مدفوع.',
    UNKNOWN_MODEL:'النموذج غير موجود في القائمة المعتمدة.',
    ENGINE_NOT_FOUND:'المحرك غير موجود أو غير متاح لهذا الحساب.',
    ENGINE_BUSY:'المحرك مشغول؛ تابع نفس العملية أو أوقفها أولاً.',
    GPU_INCOMPATIBLE:'الكرت المحدد لا يلبي متطلبات المحرك؛ لم يبدأ تشغيل.',
    ENGINE_QUOTE_EXPIRED:'انتهت صلاحية عرض التشغيل؛ اطلب عرضاً جديداً.',
    ENGINE_SETTINGS_CHANGED:'تغيرت إعدادات المحرك؛ راجع عرضاً جديداً قبل التشغيل.',
    ENGINE_ALREADY_RUNNING:'المحرك لديه تشغيل قائم؛ تابع حالته بدلاً من إنشاء تشغيل آخر.',

    ACCOUNT_ALREADY_LINKED:'الحساب مربوط مسبقاً. ابحث عنه في قائمة الحسابات؛ لم يُنشأ حساب مكرر.',
    INVALID_TOKEN_FORMAT:'تنسيق المفاتيح غير صحيح. أدخل Token ID الذي يبدأ بـ ak- وToken Secret الذي يبدأ بـ as- في حقليهما، دون أمر الطرفية.',
    MODAL_OPERATION_FAILED_CHECK_PERMISSIONS:'تعذر التحقق من حساب Modal. راجع صلاحية التوكن واتصال الخدمة؛ لا يعني ذلك بالضرورة أن المفتاح خاطئ.',
    PROVIDER_TIMEOUT_STATE_UNKNOWN:'انتهى انتظار التحقق. حدّث قائمة الحسابات قبل إعادة إدخال المفاتيح؛ النتيجة غير مؤكدة.',
    ORIENTATION_REQUIRED:'حدد عمودي أو أفقي في الدردشة قبل بدء الفيلم.',
    PROJECT_BUSY:'المحادثة قيد التنفيذ؛ أوقف المهمة وتأكد من توقفها قبل حذفها.',
    PREVIEW_PENDING:'معاينة الصورة قيد التنفيذ أو تحتاج متابعة؛ لا تشغيل إضافي.',PREVIEW_LIMIT:'وصل هذا الفيلم إلى حد معاينات الصور.',PREVIEW_NOT_AVAILABLE:'عرض معاينة الصورة غير متاح؛ حدّث المحادثة.',
    MEDIA_EXPIRED: 'انتهت مدة حفظ الفيديو أو حُذف. لا يعاد توليده تلقائياً.',
    MEDIA_IN_USE: 'الفيديو مستخدم في إنتاج أو دمج جارٍ؛ انتظر اكتمال العملية قبل الحذف.',
    LOCAL_ARTIFACT_NOT_WRITABLE: 'مجلد حفظ الفيديو غير قابل للكتابة على الخادم؛ لم يبدأ تشغيل GPU. راجع صلاحيات خدمة الملفات.',
    SLOT_RETIRED: 'المحرك متقاعد نهائياً؛ سجله محفوظ ولا يمكن إعادة نشره أو تشغيله.',
    ACCOUNT_UNLINKED: 'فُصل ربط الحساب؛ لم يبدأ تشغيل جديد.',
    STOP_AND_RECONCILE_JOBS_FIRST: 'لم يُؤكد إغلاق كل موارد الحساب أو النقل منه؛ أوقف العمليات وتابع التحقق أولاً.',
    SOURCE_ACTIVE_PROFILE_NOT_READY: 'المصدر الأساسي لا يملك كل ملفات النموذج المختار بالحالة المطلوبة؛ لم يبدأ النقل.',
    ACTIVE_PROFILE_REQUIRES_CLOUD_VOLUME_SOURCE: 'هذا النموذج يحتاج خطة نقل CPU سحابية معتمدة من المصدر الأساسي؛ لا تنزيل تلقائي بديل.',
    TRANSFER_PROFILE_CHANGED_REQUOTE: 'تغير عقد ملفات النموذج؛ راجع عرض تجهيز جديداً قبل النقل.',
    TRANSFER_PLAN_CHANGED_REQUOTE: 'تغيرت قائمة الملفات أو بصمتها؛ يلزم عرض تجهيز جديد.',
    TRANSFER_SOURCE_NOT_APPROVED: 'مصدر الملفات لا يطابق المصدر المعتمد.',
    CLOUD_WORKER_NOT_DEPLOYED: 'عامل النقل غير جاهز لعقد الملفات الحالي؛ يلزم تجهيز معتمد قبل التنفيذ.',
    REFERENCE_LOCKED: 'لا يمكن تعديل الصورة أثناء المعالجة أو بعد محاولة مشهد.', REFERENCE_INVALID: 'الصورة المرجعية غير سليمة.', REFERENCE_QUOTA: 'بلغت مساحة الصور المرجعية المتاحة لحسابك. راجع الإدارة؛ لم تُحذف صورك.',
    AI_INSUFFICIENT_CREDIT:'عبّي رصيدك حتى تگدر تستخدم الدردشة والصور والتحليل. لم يُرسل طلب OpenAI جديد.',
    TEXT_BUDGET_LIMIT:'رصيد خدمة المحادثة لدى الإدارة لا يكفي حالياً؛ لم يبدأ طلب OpenAI جديد. تواصل مع الإدارة.', TEXT_LIMIT:'وصلت هذه العملية إلى حد خدمة النص؛ لم يبدأ طلب جديد.', TEXT_ALREADY_PENDING:'الرد قيد المعالجة؛ يمكنك إرسال رسالة جديدة في المحادثة.', OPENAI_KEY_REQUIRED:'خدمة المحادثة تحتاج إعداد مفتاحها من الإدارة.',
    INSUFFICIENT_CREDIT: 'رصيدك لا يكفي. اشحن محفظة الأفلام أولاً.', SERVER_LOCKED: 'المحرك مقفول من الإدارة.', SERVER_BUSY: 'المحرك مشغول حالياً.', USER_HAS_RENTAL: 'لديك جلسة قائمة؛ تابعها أولاً.', NOT_FOUND: 'العنصر غير موجود أو غير متاح لك.', FORBIDDEN: 'هذه العملية للمسؤول فقط.', APPROVAL_REQUIRED: 'راجع السعر ووافق على التكلفة أولاً.', PAID_DISABLED: 'التشغيل المدفوع مقفل.', INVALID_INPUT: 'راجع الحقول المطلوبة.', INVALID_MONEY: 'اكتب مبلغاً صحيحاً بالدولار.', TEXT_DISABLED: 'كتابة القصة غير مفعلة.', RENTAL_NOT_READY: 'المحرك غير جاهز بعد.', PLAN_REQUIRED: 'اعتمد تقرير الفيلم أولاً.', COST_CHANGED: 'تغير العرض؛ راجع السعر والإعدادات مجدداً.', NO_CAPACITY: 'بلغ الحساب حد الجلسات.', REAL_GPU_TEST_REQUIRED: 'يلزم اختبار فعلي ومراجعة الصورة والصوت.', MAX_TWO_SLOTS: 'الحد محركان لكل حساب.', ACCOUNT_IN_USE: 'الحساب مرتبط بمحركات أو جلسات.', PRIMARY_ACCOUNT_IS_FIXED: 'لا يمكن فصل الحساب الأساسي.', IDEMPOTENCY_CONFLICT: 'معرّف العملية مستخدم ببيانات أخرى.', SCENE_ALREADY_ATTEMPTED: 'للمشهد محاولة محفوظة تحتاج متابعة.',
};
function registrySourceURL(value) {
    if(typeof value!=='string')return null;
    try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&!url.search&&!url.hash&&['github.com','huggingface.co'].includes(url.hostname)?url.href:null;}catch{return null;}
}
function registryMissingFiles(value,secrets){
 if(!Array.isArray(value))return [];
 return value.filter(f=>record(f)&&typeof f.path==='string'&&f.path.length<=500&&/^[A-Za-z0-9_./-]+$/.test(f.path)&&!f.path.startsWith('/')&&!f.path.split('/').some(p=>!p||p==='.'||p==='..')&&Number.isSafeInteger(f.size)&&f.size>=0&&!secrets.some(s=>s&&f.path.includes(s))&&!/\b(?:sk-|ak-|as-)[A-Za-z0-9_-]{8,}/.test(f.path)).map(f=>({path:f.path,size:f.size}));
}
function registryDependencies(value,secrets){if(!Array.isArray(value))return [];return value.filter(v=>record(v)&&typeof v.file==='string'&&/^[A-Za-z0-9_./-]{1,200}$/.test(v.file)&&!v.file.startsWith('/')&&!v.file.split('/').some(s=>!s||s==='.'||s==='..')&&typeof v.sha256==='string'&&/^[a-f0-9]{64}$/.test(v.sha256)).slice(0,16).map(v=>({file:v.file,sha256:v.sha256,pins:Array.isArray(v.pins)?v.pins.filter(p=>typeof p==='string'&&p.length<=500).slice(0,256).map(p=>safeText(p,secrets,false)):[]}));}
function registryLicense(value,secrets){if(!record(value))return null;return {allowed:value.allowed===true,blockers:Array.isArray(value.blockers)?value.blockers.filter(v=>typeof v==='string'&&/^[A-Z][A-Z0-9_]{0,99}$/.test(v)):[],...(typeof value.identifier==='string'?{identifier:safeText(value.identifier,secrets,false)}:{})};}
function registryDTO(value,secrets) {
    const safe=adminDTO(value,secrets);
    const walk=(v,raw)=>Array.isArray(v)?v.map((x,i)=>walk(x,raw?.[i])):record(v)?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,k==='sourceURL'?registrySourceURL(raw?.[k]):k==='missingFiles'?registryMissingFiles(raw?.[k],secrets):k==='dependencies'?registryDependencies(raw?.[k],secrets):k==='license'?registryLicense(raw?.[k],secrets):['error','lastError','reasonCode'].includes(k)&&x!==null?(typeof x==='string'&&Object.hasOwn(safeErrors,x)?x:'ENGINE_OPERATION_FAILED'):walk(x,raw?.[k])])):v;
    return walk(safe,value);
}
async function boundedJSON(response) {
    if (Number(response.headers.get('content-length')) > LIMIT)
        throw Error('RESPONSE_TOO_LARGE');
    if (!response.body)
        throw Error('EMPTY_RESPONSE');
    const reader = response.body.getReader();
    const chunks = [];
    let count = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            count += value.byteLength;
            if (count > LIMIT)
                throw Error('RESPONSE_TOO_LARGE');
            chunks.push(value);
        }
    }
    finally {
        await reader.cancel().catch(() => { });
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function requestFilm(actor, args, env) {
    if (!actor)
        return fail('UNAUTHENTICATED', 'سجل الدخول بحسابك أولاً.');
    if (!record(args) || Object.keys(args).some(k => !['operation', 'input', 'requestId'].includes(k)) || typeof args.operation !== 'string' || !operations.has(args.operation))
        return fail('INVALID_INPUT', 'العملية غير مدعومة.');
    const { operation, input, requestId } = args;
    if (operation.startsWith('admin.') && !actor.isAdmin)
        return fail('FORBIDDEN', 'هذه العملية للمسؤول فقط.');
    try {
        if(operation==='admin.account.link'&&record(input)&&(!fields[operation].tokenId(input.tokenId)||!fields[operation].tokenSecret(input.tokenSecret)))
            return fail('INVALID_TOKEN_FORMAT',safeErrors.INVALID_TOKEN_FORMAT);
        if (!id(requestId) || !validInput(operation, input) || Buffer.byteLength(JSON.stringify(input)) > LIMIT - 4096)
            return fail('INVALID_INPUT', 'راجع الحقول المطلوبة.');
    }
    catch {
        return fail('INVALID_INPUT', 'راجع الحقول المطلوبة.');
    }
    let origin, publicMediaOrigin;
    const secret = env.FILM_BRIDGE_SECRET ?? '';
    try {
        origin = new URL(env.FILM_BACKEND_ORIGIN ?? '');
        const media = new URL(env.FILM_PUBLIC_MEDIA_ORIGIN || origin.origin);
        if(media.protocol!=='https:'||media.username||media.password||media.pathname!=='/'||media.search||media.hash)throw Error();
        publicMediaOrigin=media.origin;
        if (!/^https:\/\/[^/?#\\\s]+\/?$/.test(env.FILM_BACKEND_ORIGIN ?? '') || origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || secret.length < 32 || secret.length > 4096)
            throw Error();
    }
    catch {
        return fail('NOT_CONFIGURED', 'خدمة الأفلام غير مهيأة بعد.');
    }
    const secrets = [secret, env.FILM_BACKEND_ORIGIN ?? '', input.key ?? '', input.tokenId ?? '', input.tokenSecret ?? ''].filter(Boolean);
    const body = JSON.stringify({ requestId, actor, operation, input });
    if (Buffer.byteLength(body) > LIMIT)
        return fail('INVALID_INPUT');
    const timestamp = String(Date.now()), nonce = randomUUID();
    const signature = createHmac('sha256', secret).update(timestamp + '\n' + nonce + '\n' + body).digest('hex');
    const controller = new AbortController();
    let timer;
    try {
        const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('DEADLINE')); }, 25000); });
        // One attempt only. Even a network failure may follow an accepted, billable operation.
        const { data, ok } = await Promise.race([(async () => {
                const response = await fetch(origin.origin + '/api/film-bridge', { method: 'POST', redirect: 'error', signal: controller.signal, headers: { 'content-type': 'application/json', 'x-film-time': timestamp, 'x-film-nonce': nonce, 'x-film-signature': signature }, body });
                const result = await boundedJSON(response);
                if (!response.ok && !record(result))
                    throw Error('HTTP_ERROR');
                if (!response.ok && !result.error)
                    throw Error('HTTP_ERROR');
                return { data: result, ok: response.ok };
            })(), deadline]);
        // A project DTO has its own persisted error display field; that is not an HTTP error envelope.
        if (!ok || (record(data) && data.error && !('id' in data) && !(operation.startsWith('director.')&&'projectId' in data))) {
            if (typeof data.error === 'string' && Object.hasOwn(safeErrors, data.error))
                return fail(data.error, safeErrors[data.error],operation.startsWith('admin.engine.')&&mayDispatchPaidWork(operation)&&['ENGINE_STATE_UNKNOWN','ENGINE_TEST_STATE_UNKNOWN'].includes(data.error));
            return mayDispatchPaidWork(operation)?fail('REQUEST_STATE_UNKNOWN', 'النتيجة تحتاج متابعة آمنة.', true):fail('SERVICE_UNAVAILABLE','تعذر الاتصال حالياً؛ أعد الاتصال دون بدء توليد.');
        }
        if(operation==='final.quality.get'||operation==='final.quality.review'){
            if(!record(data)||data.assetId!==input.assetId||data.projectId!==undefined&&data.projectId!==input.id)throw Error('INVALID_FINAL_QUALITY');
            const quality={...(record(data.quality)?data.quality:{}),visualQualityCertified:false,voiceIdentityVerified:false,dialectVerified:false,lipSynchronizationVerified:false};
            return projectShape({...data,quality},finalQuality,secrets,publicMediaOrigin);
        }
        if(operation==='production.costs'){
            if(!record(data)||data.projectId!==input.id)throw Error('INVALID_PRODUCTION_COSTS');
            return projectShape(data,productionCosts,secrets,publicMediaOrigin);
        }
        if(operation==='sync.asset.get'){
            if(!record(data)||(data.assetId??data.id)!==input.assetId)throw Error('INVALID_SYNC_ASSET');
            return projectShape({...data,assetId:data.assetId??data.id,qualityCertified:false},syncAsset,secrets,publicMediaOrigin);
        }
        if(operation==='sync.timeline.get'){
            if(!record(data)||data.projectId!==input.id)throw Error('INVALID_SYNC_TIMELINE');
            return projectShape({...data,quality:{acousticAlignmentVerified:false,lipSynchronizationVerified:false,faceIdentityVerified:false}},syncTimeline,secrets,publicMediaOrigin);
        }
        if(operation==='admin.test.ticket'){
            if(!record(data)||new URL(data.url).origin!==publicMediaOrigin)throw Error('INVALID_MEDIA');
            return projectShape(data,{url:'url',expires:'value'},secrets,publicMediaOrigin);
        }
        if(operation==='admin.engine.test.asset.ticket'){
            if(!record(data))throw Error('INVALID_MEDIA');
            return projectShape(data,{url:'engineTestUrl',expires:'value',mime:'engineTestMime'},secrets,publicMediaOrigin);
        }
        return operation.startsWith('admin.engine.') ? registryDTO(data,secrets) : operation.startsWith('admin.') ? adminDTO(data, secrets) : projectShape(data, customerShapes[operation], secrets, publicMediaOrigin);
    }
    catch {
        return mayDispatchPaidWork(operation)?fail('REQUEST_STATE_UNKNOWN', 'تعذر تأكيد نتيجة الطلب.', true):fail('SERVICE_UNAVAILABLE','تعذر الاتصال حالياً؛ أعد الاتصال دون بدء توليد.');
    }
    finally {
        clearTimeout(timer);
        controller.abort();
    }
}
