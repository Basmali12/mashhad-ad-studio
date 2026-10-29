// Frozen v1 transport contract. Detailed field semantics: ../BRIDGE-CONTRACT.md
export const FILM_OPERATIONS = [
  "session",
  "wallet",
  "servers.list",
  "rental.quote",
  "rental.start",
  "rental.status",
  "rental.stop",
  "projects.list",
  "project.save",
  "project.organize",
  "project.reference.ticket",
  "project.preview.execute",
  "project.preview.view",
  "project.reference.view",
  "project.reference.remove",
  "project.get",
  "project.follow",
  "chat.submit",
  "plan.submit",
  "review.submit",
  "text.status",
  "plan.status",
  "project.generate",
  "project.launch",
  "project.resume",
  "project.merge",
  "media.ticket",
  "files.list",
  "files.ticket",
  "files.delete",
  "admin.customers.list",
  "admin.credit.add",
  "admin.accounts.list",
  "admin.account.link",
  "admin.account.inspect",
  "admin.account.activate",
  "admin.account.unlink",
  "admin.account.lock",
  "admin.account.stop",
  "admin.test.quote",
  "admin.test.execute",
  "admin.prepare.quote",
  "admin.prepare.execute",
  "admin.operation.status",
  "admin.slot.save",
  "admin.slot.reassign",
  "admin.slot.retire",
  "admin.slot.verify",
  "admin.slot.publish",
  "admin.slot.lock",
  "admin.slot.stop",
  "admin.capacity.save",
  "admin.billing.save",
  "admin.billing.list",
  "admin.rentals.list",
  "admin.alerts.list",
  "admin.alert.ack",
  "admin.text.config",
  "admin.text.key.save",
  "admin.text.key.remove"
] as const;
export type FilmOperation = typeof FILM_OPERATIONS[number];
export interface FilmActor { id:string; email:string; name?:string; isAdmin:boolean; }
export interface FilmBridgeEnvelope { requestId:string; actor:FilmActor; operation:FilmOperation; input:Record<string,unknown>; }
export interface FilmWallet { balanceMicroUSD:number; expiresAt:number|null; reservedMicroUSD:0; activeRentalId:string|null; lots:Array<{amountMicroUSD:number;remainingMicroUSD:number;expiresAt:number;expired:boolean}>; }
export interface FilmServer {id:string;name:string;gpu:string;ram:number;cpu:number;pricePerHourUSD:number;state:'locked'|'busy'|'available';availability:string;}
export interface FilmStage {phase:string;state:'running'|'completed'|'failed';}
export interface FilmRental {stages?:FilmStage[];id:string;serverId:string;state:'reserved'|'preparing'|'ready'|'stopping'|'uncertain'|'closed';elapsedSeconds:number;billedMicroUSD:number;hourPriceUSD:number;lowFunds:boolean;phase:string|null;completed:number|null;total:number|null;stopReason:string|null;message:string|null;}
export interface FilmScene {durationSeconds?:number|null;stages?:FilmStage[];mediaExpired?:boolean;visualPrompt?:string;index:number;title:string;status:'pending'|'submitted'|'done'|'needs_review';dialogue:Array<{speaker:string;text:string}>;phase:string|null;completed:number|null;total:number|null;ready:boolean;}
export interface FilmVisualReview {index:number;model:string;summary:string;visibleText:string;continuity:string;causalOrder:string;audioAssessment:"not_checked";findings:string[];suggestedCorrections:string[];sampleCount:number;computedUSD:number|null;invoiceUSD:null;}
export interface FilmImagePreview {id:string;status:'offered'|'queued'|'running'|'completed'|'failed'|'uncertain'|'expired';estimatedUSD:number;computedUSD:number|null;invoiceUSD:null;expiresAt:number;error:string|null;model:string;}
export interface FilmProject {pinned?:boolean;archived?:boolean;preview?:FilmImagePreview|null;discussion?:{readyToWrite:boolean;seconds:number|null;style:string}|null;launch?:{state:string;approvedAt:number;finishedAt:number|null}|null;directorFollow?:boolean;reviewPending?:boolean;reviewState?:string;visualReviews?:FilmVisualReview[];id:string;name:string;story:string;messages:Array<{role:'user'|'assistant';content:string;hasReference?:boolean}>;seconds:number;orientation:'portrait'|'landscape';reference:{mime:string;size:number;width:number;height:number;uploadedAt:number}|null;state:'draft'|'planned'|'generating'|'needs_review'|'completed';textPending:boolean;textUncertain:boolean;textCostPolicy:'administrator_funded_separate_from_gpu_wallet';planningCompletedScenes:number;merge:{status:'running'|'completed'|'unavailable'|'failed'|'deleted';error:string|null;duration:number|null;width:number|null;height:number|null;nativeAudio:boolean}|null;scenes:FilmScene[];error:string|null;}
export interface FilmError {error:string;message:string;}
export interface FilmEmergencyStop {id:string;requested:true;confirmed:boolean;pending:number;jobs:Array<{id:string;status:string;cloudStopped:boolean}>;rentals:Array<{id:string;state:string}>;createdAt:number;finishedAt:number|null;message:string;}

export interface FilmFile {id:string;projectId:string;index:number|'merged';kind:'scene'|'film';name:string;createdAt:number;expiresAt:number;bytes:number;}
