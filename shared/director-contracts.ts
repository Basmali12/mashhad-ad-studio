import type {ProductionCharacter,ProductionProject,ProductionTimeline} from './production-contracts';

// Customer-safe director DTOs. Never include model credentials, private source
// files, raw Responses payloads, provider instructions or billing hold details.
export type DirectorStoryMode='strict'|'creative';
export type DirectorPlanningStage='source_summary'|'outline'|'chapter'|'chapter_outline'|'scene'|'revision';
export type DirectorRevisionTarget='shot'|'scene'|'character'|'voice'|'chapter';
export interface DirectorNarrator {id:string;name:string;voice:{engineId:string;voiceId:string;locale:string};}
export interface DirectorStoryEvent {id:string;description:string;sourceStart:number;sourceEnd:number;characterIds:string[];location:string;stateAfter:string;documented:boolean;}
export interface DirectorChapter {id:string;title:string;summary:string;startMs:number;endMs:number;sourceStart:number;sourceEnd:number;events:DirectorStoryEvent[];}
export interface DirectorOutline {title:string;summary:string;durationMs:number;characters:ProductionCharacter[];narrators:DirectorNarrator[];chapters:DirectorChapter[];warnings:string[];}
export interface DirectorState {
 source?:{id:string;characters:number;sha256:string}|null;originalTextTruncated?:boolean;sourceSummariesReady?:number;sourceSummariesTotal?:number;pendingCall?:{requestId:string;status:string;stage:string}|null;nextAction?:{stage:DirectorPlanningStage;chapterId?:string;sceneId?:string;sourceIndex?:number}|null;orientation?:'portrait'|'landscape'|null;targetDurationMs?:number;lastIntent?:string|null;
 projectId:string;mode:DirectorStoryMode;originalText:string;revision:number;storyApproved:boolean;summary:string;
 messages:Array<{id:string;role:'user'|'assistant';text:string;createdAt:number}>;
 outline:DirectorOutline|null;chapterStates:Array<{id:string;state:string}>;sceneStates?:Array<{id:string;chapterId:string;state:string}>;
 revisions:Array<{id:string;stage:string;targetType:DirectorRevisionTarget|null;targetId:string|null;createdAt:number;applied:boolean;approved:boolean}>;
 proposedTimeline?:ProductionTimeline|null;pendingRevision?:{id:string;stage:string;targetType:DirectorRevisionTarget|null;targetId:string|null;summary:string;changedIds:string[]}|null;
 approvalReview?:{title:string;durationMs:number;chapterCount:number;sceneCount:number;shotCount:number;voiceIds:string[];models:string[];estimatedMicroUSD:number|null;spendLimitMicroUSD:number|null;readiness:Array<{modelId:string;state:string}>;durationIsEstimate:true;productionQuoteRequired:true}|null;
 editSuggestion?:{scope:'local'|'outline';targetType:'film'|'shot'|'scene'|'character'|'voice'|'chapter';targetId:string|null;chapterId:string|null;instruction:string}|null;
 researchSuggestion?:{needed:boolean;query:string;reason:string}|null;
 researchResults?:Array<{id:string;summary:string;claims:Array<{id:string;text:string;sourceUrls:string[];status:string}>;sources:Array<{url:string;title:string}>;citations:Array<{url:string;title:string;startIndex:number;endIndex:number}>;originalScenario:string;rightsNotes:string[];needsMoreResearch:boolean;createdAt:number;expiresAt:number}>;
 planReady:boolean;missing:string[];error:string|null;
}
export interface DirectorTextQuote {cached?:boolean;id:string;projectId:string;stage:string;estimatedMicroUSD:number|null;model:string;expiresAt:number;dispatchAvailable:boolean;blockers:string[];}
export interface DirectorCall {id:string;projectId:string;status:'queued'|'running'|'completed'|'failed'|'uncertain';stage:string;revisionId:string|null;error:string|null;usage:{inputTokens:number;cachedInputTokens:number;cacheWriteTokens:number;outputTokens:number;computedUSD:number;providerCostUSD?:number;webSearchCalls?:number;webSearchToolUSD?:number}|null;estimatedMaxUSD:number;model:string;}
export interface DirectorGetInput {id:string;}
export interface DirectorMessageQuoteInput extends DirectorGetInput {requestId:string;text?:string;textId?:string;mode?:DirectorStoryMode;}
export interface DirectorMessageInput extends DirectorGetInput {quoteId:string;requestId:string;approvedTextCost:true;}
export interface DirectorPlanQuoteInput extends DirectorGetInput {requestId:string;stage:DirectorPlanningStage;sourceIndex?:number;chapterId?:string;sceneId?:string;targetType?:DirectorRevisionTarget;targetId?:string;}
export type DirectorPlanInput=DirectorMessageInput;
export interface DirectorCallInput extends DirectorGetInput {requestId:string;}
export interface DirectorApproveInput extends DirectorGetInput {revisionId:string;requestId:string;approved:true;}
export interface DirectorCancelInput extends DirectorGetInput {requestId:string;approved:true;}
export type DirectorApprovedPlan=ProductionProject;

export interface DirectorResearchQuoteInput extends DirectorGetInput {requestId:string;query?:string;maxCalls?:1|2;maxTokens?:number;approvedExpansion?:boolean;}
export type DirectorResearchInput=DirectorMessageInput;

export interface DirectorSourceSetInput {id:string;sourceId:string;requestId:string;approved:true;}
