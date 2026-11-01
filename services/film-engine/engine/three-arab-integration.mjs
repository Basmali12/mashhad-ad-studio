import fs from 'node:fs';
import {URL} from 'node:url';
import {hash} from './store.mjs';
export const THREE_ARAB_MANIFEST=Object.freeze(JSON.parse(fs.readFileSync(new URL('./three_arab/manifest.json',import.meta.url),'utf8')));
export const THREE_ARAB_STYLES=Object.freeze({solemn:Object.freeze({name:'دينية مهيبة',demo:'005.wav',previewUrl:'https://huggingface.co/sherif1313/3arab-TTS-500M-v1-VoiceDesign/resolve/88c3b2c35dbd6da614a723afcd19b27662ab714c/005.wav',previewOnly:true}),calm:Object.freeze({name:'سرد هادئ',demo:'003.wav',previewUrl:'https://huggingface.co/sherif1313/3arab-TTS-500M-v1-VoiceDesign/resolve/88c3b2c35dbd6da614a723afcd19b27662ab714c/003.wav',previewOnly:true})});
/** Optional candidate routing. Never replace the existing Habibi adapters. */
export function selectNarrationEngine({requestedEngine=null,locale='ar-MSA',style='calm',threeArabReady=false}){
 const habibi={'ar-MSA':'habibi-msa','ar-IQ':'habibi-irq','ar-EG':'habibi-egy'}[locale];if(!habibi)throw Error('SPEECH_DIALECT_UNSUPPORTED');
 if(requestedEngine==='habibi'||requestedEngine===habibi)return {modelId:habibi,style:null,reason:'explicit_habibi_request',requiresExistingReadiness:true};
 if(requestedEngine&&requestedEngine!=='3arab-voicedesign-v1')throw Error('NARRATION_ENGINE_INVALID');
 if(locale!=='ar-MSA')return {modelId:habibi,style:null,reason:'preserved_dialect',requiresExistingReadiness:true};
 if(!Object.hasOwn(THREE_ARAB_STYLES,style))throw Error('THREE_ARAB_STYLE_INVALID');
 const available=threeArabReady===true&&THREE_ARAB_MANIFEST.commercialReady===true;
 return {modelId:'3arab-voicedesign-v1',style,available,reason:available?'approved_narration_option':'THREE_ARAB_NOT_APPROVED',automaticFallback:false};
}
export function threeArabComparisonPlan(text){
 if(typeof text!=='string'||!text.trim()||text.length>600)throw Error('THREE_ARAB_TEXT_INVALID');
 return {modelId:THREE_ARAB_MANIFEST.modelId,revision:THREE_ARAB_MANIFEST.revisions['sherif1313/3arab-TTS-500M-v1-VoiceDesign'],text,textSHA256:hash(text),approved:false,dispatch:false,samples:['solemn','calm'].map(style=>({text,style,seed:42,seconds:15,numCandidates:1,numSteps:40,trimTail:false,qualityVerified:false})),runtime:{account:'primary_only',gpu:'L40S',cpu:2,ramGiB:16,timeoutSeconds:180,startupSeconds:180,idleSeconds:10,retries:0,keepLoadedBetweenSamples:true,measured:false},knownAssetBytes:THREE_ARAB_MANIFEST.totalBytes,maximumOutputWindowsSeconds:30,noReferenceCloning:true,exactDemoRecreationGuaranteed:false,review:['word_accuracy','natural_pauses','no_missing_or_repeated_words','no_excessive_silence','male_narrator_timbre','continuity','watermark_present'],adapterVariant:THREE_ARAB_MANIFEST.adapterVariant,watermarkBackend:THREE_ARAB_MANIFEST.watermarkBackend,licenseEligible:THREE_ARAB_MANIFEST.usageEligibility.commercial==='permitted_with_license_notices',blockers:['WEIGHTS_NOT_PREPARED','NATIVE_ENVIRONMENT_UNTESTED','PAID_APPROVAL_REQUIRED']};
}

/** Director-visible options are suggestions only, never approved voice profiles. */
export function narrationDirectorOptions(){
 return {options:Object.entries(THREE_ARAB_STYLES).map(([style,s])=>({modelId:THREE_ARAB_MANIFEST.modelId,style,name:s.name,previewUrl:s.previewUrl,previewOnly:true,productionReady:false,requiresListeningApproval:true})),privateAuditionStatus:THREE_ARAB_MANIFEST.privateTrial?.status??'not_run',existingEngine:'habibi',preserveApprovedVoiceProfiles:true,canDispatch:false,blockers:['ACCOUNT_ENGINE_NOT_ADMITTED','LISTENING_REVIEW_REQUIRED'],instruction:'Use these only as candidate narration choices. Public demos are not generated samples or approved Voice Profiles. Keep existing bound voices unchanged. Never claim these voices are ready or recreate the exact demo timbre.'};
}
