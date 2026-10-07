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
import type * as continuation from "../continuation.js";
import type * as customerFiles from "../customerFiles.js";
import type * as editValidators from "../editValidators.js";
import type * as editing from "../editing.js";
import type * as files from "../files.js";
import type * as filmProduction from "../filmProduction.js";
import type * as filmProductionValidators from "../filmProductionValidators.js";
import type * as filmReview from "../filmReview.js";
import type * as filmValidators from "../filmValidators.js";
import type * as filmWorkshop from "../filmWorkshop.js";
import type * as films from "../films.js";
import type * as http from "../http.js";
import type * as images from "../images.js";
import type * as multiuserTrial from "../multiuserTrial.js";
import type * as onboarding from "../onboarding.js";
import type * as pipeline from "../pipeline.js";
import type * as pipelineValidators from "../pipelineValidators.js";
import type * as requests from "../requests.js";
import type * as runner from "../runner.js";
import type * as runnerHttp from "../runnerHttp.js";
import type * as social from "../social.js";
import type * as socialHttp from "../socialHttp.js";
import type * as studio from "../studio.js";
import type * as validators from "../validators.js";
import type * as videoLanguage from "../videoLanguage.js";
import type * as walletBilling from "../walletBilling.js";
import type * as wallets from "../wallets.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  adminCode: typeof adminCode;
  adminGate: typeof adminGate;
  continuation: typeof continuation;
  customerFiles: typeof customerFiles;
  editValidators: typeof editValidators;
  editing: typeof editing;
  files: typeof files;
  filmProduction: typeof filmProduction;
  filmProductionValidators: typeof filmProductionValidators;
  filmReview: typeof filmReview;
  filmValidators: typeof filmValidators;
  filmWorkshop: typeof filmWorkshop;
  films: typeof films;
  http: typeof http;
  images: typeof images;
  multiuserTrial: typeof multiuserTrial;
  onboarding: typeof onboarding;
  pipeline: typeof pipeline;
  pipelineValidators: typeof pipelineValidators;
  requests: typeof requests;
  runner: typeof runner;
  runnerHttp: typeof runnerHttp;
  social: typeof social;
  socialHttp: typeof socialHttp;
  studio: typeof studio;
  validators: typeof validators;
  videoLanguage: typeof videoLanguage;
  walletBilling: typeof walletBilling;
  wallets: typeof wallets;
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
