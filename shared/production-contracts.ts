// Public production DTOs only. Provider credentials, paths, accounts and private jobs stay server-side.
export type ProductionStageKind='analyze'|'plan'|'character_image'|'scene_image'|'voice'|'voice_merge'|'align'|'alignment_merge'|'timeline_sync'|'lip_sync'|'animate'|'sync'|'effects'|'merge'|'quality'|'save';
export type ProductionState='draft'|'planning'|'planned'|'quoted'|'awaiting_approval'|'queued'|'approved'|'running'|'cancelling'|'cancelled'|'completed'|'failed'|'needs_review'|'uncertain';
export type ProductionStageState='pending'|'queued'|'running'|'completed'|'failed'|'needs_review'|'uncertain'|'cancelled'|'blocked';
export interface ProductionCharacter {id:string;name:string;description:string;age:number|null;face:string;body:string;wardrobe:string;props:Array<{id:string;description:string}>;referenceIds:string[];angles:string[];voice:{engineId:string;voiceId:string;locale:string};relationships:Array<{characterId:string;description:string}>;}
export type ProductionAudioLayer='narration'|'dialogue'|'vocal_event'|'ambience'|'foley'|'music'|'intentional_silence';
export interface ProductionSoundEffect {id:string;description:string;startMs:number;endMs:number;assetId?:string;layer?:ProductionAudioLayer;category?:string;gainDb?:number;duckingRequested?:boolean;sourceOffsetMs?:number;requested?:boolean;eventAnchor?:{eventId:string;offsetMs?:number;durationMs:number};}
export interface ProductionTransition {type:'cut'|'fade';durationMs:number;requested:true;}
export interface ProductionChapter {id:string;title:string;startMs:number;endMs:number;}
export interface ProductionScene {id:string;chapterId:string;description:string;startMs:number;endMs:number;}
export interface ProductionCharacterEdit {characterId:string;expression?:string;pose?:string;wardrobe?:string;reason?:string;}
export interface ProductionMotionPlan {start:string;development:string;end:string;camera:string;}
export interface ProductionShot {transition?:ProductionTransition|null;audioCue?:{utteranceId:string;wordIndex:number|null;sentenceIndex:number|null}|null;requires_lip_sync?:boolean;videoModelId?:'wan22-i2v-a14b'|'hunyuanvideo15'|null;generationMode?:'image_to_video'|'text_to_video';videoSelectionIntent?:'quiet'|'complex_motion'|'cost'|null;videoSelection?:{modelId:string;reason:string;source:string;automaticFallback:false}|null;motionPlan?:ProductionMotionPlan|null;motionBeats?:ProductionMotionPlan[];wanSegment?:{sourceShotId:string;index:number;count:number}|null;characterEdits?:ProductionCharacterEdit[];id:string;chapterId:string;sceneId:string;startMs:number;endMs:number;prompt:string;location:string;characterMotion:string;cameraMotion:string;soundEffects:ProductionSoundEffect[];characterIds:string[];propIds:string[];referenceIds:string[];utteranceIds:string[];eventIds:string[];intentionalRepeatOf:string|null;}
export interface ProductionUtterance {id:string;characterId:string|null;narratorId?:string|null;role?:'dialogue'|'narration'|'vocal_event';expression?:string;text:string;startMs:number;endMs:number;intentionalRepeat:boolean;repeatOf:string|null;allowOverlap:boolean;}
export interface ProductionTimeline {chapters:ProductionChapter[];scenes:ProductionScene[];shots:ProductionShot[];utterances:ProductionUtterance[];}
export interface ProductionProgress {completed:number|null;total:number|null;unit:string|null;}
export interface ProductionActivity {code:string;label:string;stageId:string|null;progress?:ProductionProgress|null;}
export interface ProductionStage {id:string;kind:ProductionStageKind;state:ProductionStageState;attempts:number;progress:ProductionProgress|null;error:string|null;result:{assetIds:string[]}|null;}
export interface ProductionResult {artifactId:string;sha256:string;bytes:number;durationMs:number;width:number;height:number;hasAudio:boolean;mediaId:string|null;mediaReady:boolean;}
export interface ProductionProject {source?:ProductionSource|null;storyTruncated?:boolean;referenceIds?:string[];pinned?:boolean;archived?:boolean;createdAt?:number;updatedAt?:number;activity?:ProductionActivity;measuredDurationMs?:number|null;error?:string|null;completedPhases?:Array<'images'|'animation'|'audio'|'synchronization'>;cancelRequested?:boolean;id:string;title:string;story:string;durationMs:number;state:ProductionState;revision:number;characters:ProductionCharacter[];narrators?:Array<{id:string;name:string;voice:{engineId:string;voiceId:string;locale:string}}>;timeline:ProductionTimeline|null;stages:ProductionStage[];result:ProductionResult|null;}
export interface ProductionQuote {availableMicroUSD?:number;canAfford?:boolean;spendLimitMicroUSD?:number;phase?:'images'|'animation'|'audio'|'synchronization'|'film';id:string;projectId:string;planRevision:number;estimatedMicroUSD:number|null;dispatchAvailable:boolean;expiresAt:number;stages:Array<{id:string;kind:ProductionStageKind;estimatedMicroUSD:number|null;available:boolean;blockers:string[]}>;blockers:string[];}
export interface ProductionCreateInput {requestId:string;title:string;story?:string;sourceId?:string;durationMs:number;referenceIds?:string[];}
export interface ProductionQuoteInput {id:string;phase?:'images'|'animation'|'audio'|'synchronization';}
export interface ProductionPlanInput {id:string;requestId:string;}
export interface ProductionApproveInput {id:string;quoteId:string;requestId:string;approved:true;spendLimitMicroUSD?:number;}
export interface ProductionRetryInput extends ProductionApproveInput {stageId:string;}
export interface ProductionCancelInput {id:string;approved:true;}

export interface ProductionSource {id:string;characters:number;sha256:string|null;state?:string;nextChunk?:number;}
export interface ProductionSourceBeginInput {requestId:string;totalCharacters:number;}
export interface ProductionSourceChunkInput {id:string;index:number;text:string;}
export interface ProductionSourceCompleteInput {id:string;chunkCount:number;}
export interface ProductionSourceGetInput {id:string;offset:number;limit:number;}
export interface ProductionOrganizeInput {id:string;action:"rename"|"pin"|"unpin"|"archive"|"restore";name?:string;}
