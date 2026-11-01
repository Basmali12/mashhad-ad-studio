// Public synchronization metadata only. No provider requests, paths, raw bytes,
// source credentials, rights evidence or customer-selected identity fields.
export interface SyncFaceApproveInput {
  id:string;shotId:string;characterId:string;videoAssetId:string;
  trackId:'face-0';faceCount:1;reviewed:true;
}
export interface SyncFaceBinding {
  id?:string;faceBindingId?:string;projectId:string;shotId:string;
  characterId:string;videoAssetId:string;trackId:'face-0';faceCount:1;
  reviewed:boolean;sourceVideoSHA256:string;createdAt:number;
}
export interface SyncAssetGetInput {id:string;assetId:string;}
export interface SyncReviewInput extends SyncAssetGetInput {
  kind:'alignment'|'video';reviewed:true;accepted:true;
}
export interface SyncReviewResult {
  assetId:string;approved:boolean;reviewed:boolean;qualityCertified:false;
}
export interface SyncWordTiming {text:string;startMs:number;endMs:number;confidence:number|null;}
export interface SyncSentenceTiming {text:string;startMs:number;endMs:number;}
export interface SyncAlignmentMetadata {
  words:SyncWordTiming[]|null;sentences:SyncSentenceTiming[]|null;
  durationMs:number;confidence:number|null;needsReview:boolean;
  accuracyCertified:false;transcriptVerified:false;
}
export interface SyncPublicAsset {
  assetId:string;kind:'alignment'|'video';utteranceId?:string;
  shotId?:string;speakerId?:string;characterId?:string|null;
  voiceProfileId?:string;durationMs:number;sha256:string;
  alignment?:SyncAlignmentMetadata;needsReview:boolean;
  approved:boolean;reviewed:boolean;qualityCertified:false;
  reviewFindings?:string[];
}
export interface SyncTimelineGetInput {id:string;offset?:number;limit?:number;}
export interface SyncTimelineShot {
  shotId:string;sceneId:string|null;chapterId:string|null;
  videoAssetId:string|null;startMs:number;endMs:number;
  sourceStartMs:number;sourceEndMs:number;utteranceIds:string[];
  requiresLipSync:boolean;roundingMs:number;
}
export interface SyncAudioTrack {
  assetId:string;utteranceId:string;speakerId:string;voiceProfileId:string;
  startMs:number;endMs:number;sourceOffsetMs:number;
}
export interface SyncVisualExtensionRequest {
  shotId:string;videoAssetId:string|null;startMs:number;endMs:number;
  missingDurationMs:number;approvalRequired:true;automaticExecution:false;
  reason:string;
}
export interface SyncQualityMetadata {
  acousticAlignmentVerified:false;lipSynchronizationVerified:false;
  faceIdentityVerified:false;
}
export interface SyncTimelinePage {
  projectId:string;durationMs:number;needsReview:boolean;
  reviewReasons:Array<{code:string;subjectId?:string;shotId?:string}>;
  visualExtensionRequests:SyncVisualExtensionRequest[];
  offset:number;totalShots:number;shots:SyncTimelineShot[];
  audioTracks:SyncAudioTrack[];quality:SyncQualityMetadata;
}
