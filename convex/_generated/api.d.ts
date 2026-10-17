/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as adminCode from "../adminCode.js";
import type * as adminGate from "../adminGate.js";
import type * as buffer from "../buffer.js";
import type * as bufferHttp from "../bufferHttp.js";
import type * as continuation from "../continuation.js";
import type * as crons from "../crons.js";
import type * as customerFiles from "../customerFiles.js";
import type * as editValidators from "../editValidators.js";
import type * as editing from "../editing.js";
import type * as fileMetadata from "../fileMetadata.js";
import type * as files from "../files.js";
import type * as filmProduction from "../filmProduction.js";
import type * as filmProductionValidators from "../filmProductionValidators.js";
import type * as filmReview from "../filmReview.js";
import type * as filmValidators from "../filmValidators.js";
import type * as filmWorkshop from "../filmWorkshop.js";
import type * as films from "../films.js";
import type * as flowAccounts from "../flowAccounts.js";
import type * as flowBalances from "../flowBalances.js";
import type * as http from "../http.js";
import type * as images from "../images.js";
import type * as legacyFileOwnership from "../legacyFileOwnership.js";
import type * as libraryPublishing from "../libraryPublishing.js";
import type * as mediaAssets from "../mediaAssets.js";
import type * as multiuserTrial from "../multiuserTrial.js";
import type * as onboarding from "../onboarding.js";
import type * as personalCleanup from "../personalCleanup.js";
import type * as personalFlow from "../personalFlow.js";
import type * as pipeline from "../pipeline.js";
import type * as pipelineValidators from "../pipelineValidators.js";
import type * as privateStudioImages from "../privateStudioImages.js";
import type * as privateStudioVideos from "../privateStudioVideos.js";
import type * as privateVideoDelete from "../privateVideoDelete.js";
import type * as publishingBuffer from "../publishingBuffer.js";
import type * as publishingBufferHttp from "../publishingBufferHttp.js";
import type * as publishingBufferPersonal from "../publishingBufferPersonal.js";
import type * as publishingBufferValidators from "../publishingBufferValidators.js";
import type * as publishingCollections from "../publishingCollections.js";
import type * as publishingFiles from "../publishingFiles.js";
import type * as publishingUploadTickets from "../publishingUploadTickets.js";
import type * as publishingUsers from "../publishingUsers.js";
import type * as reelsAdmin from "../reelsAdmin.js";
import type * as reelsBanner from "../reelsBanner.js";
import type * as reelsBilling from "../reelsBilling.js";
import type * as reelsBufferBinding from "../reelsBufferBinding.js";
import type * as reelsCalendar from "../reelsCalendar.js";
import type * as reelsImport from "../reelsImport.js";
import type * as reelsInsights from "../reelsInsights.js";
import type * as reelsJobs from "../reelsJobs.js";
import type * as reelsPublishingPolicy from "../reelsPublishingPolicy.js";
import type * as reelsRetention from "../reelsRetention.js";
import type * as reelsSingleTest from "../reelsSingleTest.js";
import type * as reelsStorage from "../reelsStorage.js";
import type * as reelsStorageHttp from "../reelsStorageHttp.js";
import type * as reelsUploadQuota from "../reelsUploadQuota.js";
import type * as reelsWorker from "../reelsWorker.js";
import type * as reelsWorkerHttp from "../reelsWorkerHttp.js";
import type * as reelsWorkerState from "../reelsWorkerState.js";
import type * as requests from "../requests.js";
import type * as runner from "../runner.js";
import type * as runnerHttp from "../runnerHttp.js";
import type * as social from "../social.js";
import type * as socialHttp from "../socialHttp.js";
import type * as storyProjects from "../storyProjects.js";
import type * as storyResearch from "../storyResearch.js";
import type * as storyResearchRun from "../storyResearchRun.js";
import type * as studio from "../studio.js";
import type * as studioChat from "../studioChat.js";
import type * as subscriptionPolicy from "../subscriptionPolicy.js";
import type * as trendSearchRun from "../trendSearchRun.js";
import type * as trends from "../trends.js";
import type * as validators from "../validators.js";
import type * as videoAnalysis from "../videoAnalysis.js";
import type * as videoAnalysisRun from "../videoAnalysisRun.js";
import type * as videoCleanup from "../videoCleanup.js";
import type * as videoLanguage from "../videoLanguage.js";
import type * as walletBilling from "../walletBilling.js";
import type * as wallets from "../wallets.js";
import type * as youtube from "../youtube.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  adminCode: typeof adminCode;
  adminGate: typeof adminGate;
  buffer: typeof buffer;
  bufferHttp: typeof bufferHttp;
  continuation: typeof continuation;
  crons: typeof crons;
  customerFiles: typeof customerFiles;
  editValidators: typeof editValidators;
  editing: typeof editing;
  fileMetadata: typeof fileMetadata;
  files: typeof files;
  filmProduction: typeof filmProduction;
  filmProductionValidators: typeof filmProductionValidators;
  filmReview: typeof filmReview;
  filmValidators: typeof filmValidators;
  filmWorkshop: typeof filmWorkshop;
  films: typeof films;
  flowAccounts: typeof flowAccounts;
  flowBalances: typeof flowBalances;
  http: typeof http;
  images: typeof images;
  legacyFileOwnership: typeof legacyFileOwnership;
  libraryPublishing: typeof libraryPublishing;
  mediaAssets: typeof mediaAssets;
  multiuserTrial: typeof multiuserTrial;
  onboarding: typeof onboarding;
  personalCleanup: typeof personalCleanup;
  personalFlow: typeof personalFlow;
  pipeline: typeof pipeline;
  pipelineValidators: typeof pipelineValidators;
  privateStudioImages: typeof privateStudioImages;
  privateStudioVideos: typeof privateStudioVideos;
  privateVideoDelete: typeof privateVideoDelete;
  publishingBuffer: typeof publishingBuffer;
  publishingBufferHttp: typeof publishingBufferHttp;
  publishingBufferPersonal: typeof publishingBufferPersonal;
  publishingBufferValidators: typeof publishingBufferValidators;
  publishingCollections: typeof publishingCollections;
  publishingFiles: typeof publishingFiles;
  publishingUploadTickets: typeof publishingUploadTickets;
  publishingUsers: typeof publishingUsers;
  reelsAdmin: typeof reelsAdmin;
  reelsBanner: typeof reelsBanner;
  reelsBilling: typeof reelsBilling;
  reelsBufferBinding: typeof reelsBufferBinding;
  reelsCalendar: typeof reelsCalendar;
  reelsImport: typeof reelsImport;
  reelsInsights: typeof reelsInsights;
  reelsJobs: typeof reelsJobs;
  reelsPublishingPolicy: typeof reelsPublishingPolicy;
  reelsRetention: typeof reelsRetention;
  reelsSingleTest: typeof reelsSingleTest;
  reelsStorage: typeof reelsStorage;
  reelsStorageHttp: typeof reelsStorageHttp;
  reelsUploadQuota: typeof reelsUploadQuota;
  reelsWorker: typeof reelsWorker;
  reelsWorkerHttp: typeof reelsWorkerHttp;
  reelsWorkerState: typeof reelsWorkerState;
  requests: typeof requests;
  runner: typeof runner;
  runnerHttp: typeof runnerHttp;
  social: typeof social;
  socialHttp: typeof socialHttp;
  storyProjects: typeof storyProjects;
  storyResearch: typeof storyResearch;
  storyResearchRun: typeof storyResearchRun;
  studio: typeof studio;
  studioChat: typeof studioChat;
  subscriptionPolicy: typeof subscriptionPolicy;
  trendSearchRun: typeof trendSearchRun;
  trends: typeof trends;
  validators: typeof validators;
  videoAnalysis: typeof videoAnalysis;
  videoAnalysisRun: typeof videoAnalysisRun;
  videoCleanup: typeof videoCleanup;
  videoLanguage: typeof videoLanguage;
  walletBilling: typeof walletBilling;
  wallets: typeof wallets;
  youtube: typeof youtube;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
