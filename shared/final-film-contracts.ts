import type {ProductionStageKind} from './production-contracts';

// Final-film metadata only. Source license evidence, provider requests,
// filesystem paths, raw FFmpeg output and wallet-lot entries stay server-side.
export interface SoundEffectListInput {id:string;}
export interface SoundEffectAsset {
  id:string;assetId:string;name:string;category:string;durationMs:number;
  sampleRate:number;channels:number;bytes:number;sha256:string;
  licenseAttested:boolean;licenseVerified:false;approved:boolean;createdAt:number;
}
export interface SoundEffectEventApproveInput {
  id:string;shotId:string;eventId:string;videoAssetId:string;
  offsetMs:number;reviewed:true;
}
export interface SoundEffectEventBinding {
  id:string;shotId:string;eventId:string;videoAssetId:string;
  sourceSHA256:string;offsetMs:number;reviewed:boolean;
  timingVerified:boolean;revision?:number;createdAt:number;reviewedAt?:number;
}
export interface FinalQualityGetInput {id:string;assetId:string;}
export interface FinalQualityReviewInput extends FinalQualityGetInput {reviewed:true;accepted:true;}
export interface FinalQualityInterval {startMs:number;endMs:number;durationMs:number;intentional?:boolean;}
export interface FinalQualityFinding {
  code:string;severity:string;startMs?:number;endMs?:number;
  durationMs?:number;value?:number|null;
}
export interface FinalFilmQuality {
  id:string;assetId:string;sourceSHA256:string;settingsFingerprint:string;
  checkedAt:number;status:'needs_review'|'reviewed';needsReview:boolean;
  reviewed:boolean;reviewedAt:number|null;findings:FinalQualityFinding[];
  quality:{
    structuralVerified:boolean;observationsCompleted:boolean;
    visualQualityCertified:false;voiceIdentityVerified:false;
    dialectVerified:false;lipSynchronizationVerified:false;
    humanReviewed:boolean;decodedDurationMs:number;width:number;
    height:number;fps:number;hasAudio:boolean;
  };
  measurements:{
    blackIntervals:FinalQualityInterval[];freezeIntervals:FinalQualityInterval[];
    silenceIntervals:FinalQualityInterval[];peakLevelDb:number|null;
    peakCount:number|null;sampleCount:number|null;clippingRatio:number|null;
    audioClippingStatus:string;
    measuredAudioMs?:number|null;decodedVideoMs?:number;
  };
}
export interface ProductionCostsInput {id:string;}
export interface ProductionCustomerCostTotals {
  estimatedMicroUSD:number|null;settledMicroUSD:number;
  heldMicroUSD:number;uncertainMicroUSD:number;
}
export interface ProductionStageCost extends ProductionCustomerCostTotals {
  stageId:string;kind:ProductionStageKind;resourceSeconds:number|null;
  recordedProviderUSD:number|null;
}
export interface ProductionCostBreakdown {
  projectId:string;currency:'USD';requestedDurationMs:number;
  actualDurationMs:number|null;customer:ProductionCustomerCostTotals;
  stages:ProductionStageCost[];
  planning:{settledMicroUSD:number;heldMicroUSD:number;recordedProviderUSD:number|null};
  recordedProviderUSD:number|null;storageUSD:number|null;additionalUSD:number|null;
  computedFrom:'recorded_stage_receipts';
}
