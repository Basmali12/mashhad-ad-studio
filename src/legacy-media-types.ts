import type {ChatVideoProposal} from '../shared/chat-video';
import type {FlowOption} from '../shared/pipeline';
// Data-only compatibility for archived IndexedDB records, no executable generator.
export interface EndingVideo {file:File;durationSeconds:number}
export interface VideoRequest extends ChatVideoProposal {id:string;messageId:string;references:File[];status:'draft'|'working'|'ready'|'failed';jobId?:string;requestId?:string;url?:string;error?:string;stage?:string;connectionState?:string;quote?:{option:FlowOption;credits:number;observedAt:number;count:number};referenceIds?:string[]}
