import {hash} from './store.mjs';
import {speechSignal} from './narration-mastering.mjs';
import {narrationStyle,matchNarrationStyle,narrationComparisonPlan} from './narration-styles.mjs';
/** A reference is eligible only after rights AND listening approval. No downloads. */
export function createNarrationProfiles({store,voiceProfiles,manifests,now=Date.now}){
 const owner=i=>{if(!i.actor||i.actor.isAdmin!==true&&i.actor.customerId!==i.customerId)throw Error('FORBIDDEN');};
 const safe=r=>({id:r.id,styleId:r.styleId,referenceAssetId:r.referenceAssetId,locale:r.locale,listeningApproved:r.listeningApproved,productionAllowed:r.productionAllowed});
 async function register(i){
  if(i.actor?.isAdmin!==true)throw Error('FORBIDDEN');narrationStyle(i.styleId);
  if(!['ar-MSA','ar-IQ','ar-EG'].includes(i.locale)||i.gender!=='male'||i.listeningApproved!==true||i.productionAllowed!==true||!i.rightsEvidence||!['consent','licensed'].includes(i.rightsEvidence.kind)||i.rightsEvidence.voiceUseAllowed!==true||i.rightsEvidence.privateOnly!==false||typeof i.rightsEvidence.source!=='string'||!i.rightsEvidence.source.trim()||i.rightsEvidence.source.length>1000||typeof i.rightsEvidence.documentId!=='string'||!i.rightsEvidence.documentId.trim()||i.rightsEvidence.documentId.length>200||!['clean','matching_transcript','natural_delivery'].every(k=>i.listeningChecks?.[k]===true))throw Error('NARRATION_REFERENCE_APPROVAL_REQUIRED');
  const ref=await voiceProfiles.readReference(i);const signal=speechSignal(ref.bytes);if(signal.silenceOrVeryQuiet||signal.clippedSamples||signal.peakDB>-0.3)throw Error('NARRATION_REFERENCE_SIGNAL_INVALID');if(ref.rightsAttestation.kind!==i.rightsEvidence.kind)throw Error('NARRATION_RIGHTS_MISMATCH');
  const id=hash(JSON.stringify([i.customerId,i.referenceAssetId,i.styleId,i.locale])),row={id,customerId:i.customerId,referenceAssetId:i.referenceAssetId,referenceSHA256:ref.sha256,styleId:i.styleId,locale:i.locale,gender:i.gender,listeningApproved:true,productionAllowed:true,signal,rightsEvidence:{...i.rightsEvidence},listeningChecks:{...i.listeningChecks},createdAt:now()};
  await store.put('narration-reference',row);await store.audit('narration_reference_approved',id);return safe(row);
 }
 async function select(i){owner(i);const style=i.styleId?narrationStyle(i.styleId):matchNarrationStyle(i.description??'').style;
  const records=(await store.all('narration-reference')).filter(r=>r.customerId===i.customerId&&r.styleId===style.id&&r.locale===(i.locale??'ar-MSA')&&r.productionAllowed&&r.listeningApproved).sort((a,b)=>a.id.localeCompare(b.id));
  const r=i.referenceAssetId?records.find(v=>v.referenceAssetId===i.referenceAssetId):i.referenceId?records.find(v=>v.id===i.referenceId):records[0];if(!r)return {style,available:false,reason:'NARRATION_LICENSED_REFERENCE_REQUIRED',reference:null};
  const ref=await voiceProfiles.readReference({...i,referenceAssetId:r.referenceAssetId});if(ref.sha256!==r.referenceSHA256)throw Error('VOICE_REFERENCE_CHANGED');
  return {style,available:true,reference:safe(r),identityGuaranteed:false};
 }
 async function bind(i){owner(i);const chosen=await select(i);if(!chosen.available)throw Error(chosen.reason);const {style,reference}=chosen,modelId={'ar-MSA':'habibi-msa','ar-IQ':'habibi-irq','ar-EG':'habibi-egy'}[reference.locale],m=manifests[modelId];
  // Existing immutable per-project binding rejects a later replacement.
  return voiceProfiles.create({...i,name:style.label,approved:true,modelId,version:m.version,revision:m.revision,locale:reference.locale,gender:'male',tone:style.label,referenceAssetId:reference.referenceAssetId,settings:{seed:42,speakingRate:style.speakingRate,narrationStyle:style.id,textPolicy:i.textPolicy??style.textPolicy,mastering:style.mastering}});
 }
 async function comparison(i){owner(i);const plan=narrationComparisonPlan();for(const s of plan.samples){const choice=await select({...i,styleId:s.styleId,locale:'ar-MSA'});s.referenceAssetId=choice.reference?.referenceAssetId??null;s.state=choice.available?'awaiting_paid_test_approval':s.state;}return plan;}
 return {register,select,bind,comparison};
}
