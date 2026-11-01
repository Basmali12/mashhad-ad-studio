// Frozen v1 transport contract. Detailed field semantics: ../BRIDGE-CONTRACT.md
export const FILM_OPERATIONS = [
  "sfx.list", "sfx.event.approve", "final.quality.get", "final.quality.review", "production.costs",
  "sync.face.approve", "sync.asset.get", "sync.review", "sync.timeline.get",
  "director.research.quote", "director.research", "director.get", "director.message.quote", "director.message", "director.plan.quote", "director.plan", "director.call", "director.approve", "director.cancel",
  "production.legacy.import", "director.source.set", "production.reference.attach",
  "production.source.begin", "production.source.chunk", "production.source.complete", "production.source.get", "production.organize",
  "production.create",
  "production.get",
  "production.list",
  "production.plan",
  "production.quote",
  "production.approve",
  "production.retry",
  "production.cancel",
  "session",
  "preferences.get",
  "preferences.save",
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
  "admin.engine.test.project", "admin.engine.test.quote", "admin.engine.test.execute", "admin.engine.test.status", "admin.engine.test.review", "admin.engine.test.stop", "admin.engine.test.asset.ticket", "admin.engine.approve", "admin.engine.publish", "admin.engine.unpublish",
  "admin.engine.models",
  "admin.engine.list",
  "admin.engine.save",
  "admin.engine.inspect",
  "admin.engine.quote",
  "admin.engine.start",
  "admin.engine.prepare",
  "admin.engine.stop",
  "admin.engine.status",
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
  "admin.test.status",
  "admin.test.ticket",
  "admin.test.publish",
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
export interface FilmProject {orientationConfirmed?:boolean;pinned?:boolean;archived?:boolean;preview?:FilmImagePreview|null;discussion?:{readyToWrite:boolean;seconds:number|null;style:string}|null;launch?:{state:string;approvedAt:number;finishedAt:number|null}|null;directorFollow?:boolean;reviewPending?:boolean;reviewState?:string;visualReviews?:FilmVisualReview[];id:string;name:string;story:string;messages:Array<{role:'user'|'assistant';content:string;hasReference?:boolean}>;seconds:number;orientation:'portrait'|'landscape';reference:{mime:string;size:number;width:number;height:number;uploadedAt:number}|null;state:'draft'|'planned'|'generating'|'needs_review'|'completed';textPending:boolean;textUncertain:boolean;textCostPolicy:'administrator_funded_separate_from_gpu_wallet';planningCompletedScenes:number;merge:{status:'running'|'completed'|'unavailable'|'failed'|'deleted';error:string|null;duration:number|null;width:number|null;height:number|null;nativeAudio:boolean}|null;scenes:FilmScene[];error:string|null;}
export interface FilmError {error:string;message:string;}
export interface FilmEmergencyStop {id:string;requested:true;confirmed:boolean;pending:number;jobs:Array<{id:string;status:string;cloudStopped:boolean}>;rentals:Array<{id:string;state:string}>;createdAt:number;finishedAt:number|null;message:string;}

export interface FilmFile {id:string;projectId:string;index:number|'merged';kind:'scene'|'film';name:string;createdAt:number;expiresAt:number;bytes:number;durationMs?:number;width?:number;height?:number;thumbnailReady?:boolean;}

// Generic administrator-only registry. Catalog entries are inactive declarations, not installed adapters.
export type FilmEngineGPU = 'RTX-PRO-6000'|'L40S';
export type FilmEngineRuntimeState = 'stopped'|'starting'|'running'|'stopping'|'failed';
export interface FilmEngineModel {id:string;name:string;version:string|null;kind:string;variant:string|null;enabled:false;sourceURL:string|null;sourceVerification:string;revision:string|null;resources:{recommendedCPU:number|null;recommendedRAMGiB:number|null;recommendedVRAMGiB:number|null;verification:string;note:string};}
export interface FilmEngineRuntime {id?:string;state:FilmEngineRuntimeState;cloudStopped:boolean;elapsedSeconds:number;estimatedCustomerUSD:number;recordedProviderUSD:number|null;error:string|null;requiresReconcile:boolean;}
export interface FilmEnginePreparationProgress {phase?:string;completed?:number;total?:number;unit?:string;file?:string;transferredBytes?:number;completedBytes?:number;totalBytes?:number;filesCompleted?:number;totalFiles?:number;}
export interface FilmEnginePreparation {status:string;progress:FilmEnginePreparationProgress|null;error:string|null;cloudStopped:boolean;}
export interface FilmEngineEntry {id:string;name:string;modelId:string;modelName:string;version:string|null;kind:string;variant:string|null;accountId:string;gpu:FilmEngineGPU;cpu:number;ramGiB:number;minVramGiB:number|null;volume:string|null;weightPath:string;preparationState:string;deploymentState:'unpublished'|'deployed';expectedBytes:number|null;softwareInstalled:boolean;preparation:FilmEnginePreparation|null;enabled:boolean;adapterAvailable:boolean;hourPriceUSD:number;revision:number;runtime:FilmEngineRuntime;blockers:string[];}
export interface FilmEngineSaveInput {id?:string;modelId:string;accountId:string;name:string;version?:string|null;gpu:FilmEngineGPU;cpu:number;ramGiB:number;minVramGiB?:number|null;volume?:string;hourPriceUSD:string;}
export interface FilmEngineQuoteInput {id:string;action:'start'|'prepare';}
export interface FilmEngineQuote {id:string;engineId:string;action:'start'|'prepare';expiresAt:number;settingsRevision:number;expectedBytes?:number|null;missingBytes?:number|null;fileCount?:number|null;missingFiles?:Array<{path:string;size:number}>;estimate:{resourceWindowUSD:number|null;expectedSeconds?:number|null;windowSeconds?:number|null;customerRateUSD?:number;recordedUSD:number|null;networkUSD?:number|null;storageUSDPerMonth?:number|null;buildUSD?:number|null;note:string};dispatchAvailable:boolean;blockers:string[];}
export interface FilmEngineStartInput {id:string;quoteId:string;requestId:string;approved:true;}
export interface FilmEnginePrepareInput {id:string;quoteId:string;requestId:string;approved:true;}
export interface FilmEngineStopInput {id:string;approved:true;}
