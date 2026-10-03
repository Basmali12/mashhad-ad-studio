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
import type * as editValidators from "../editValidators.js";
import type * as editing from "../editing.js";
import type * as files from "../files.js";
import type * as http from "../http.js";
import type * as pipeline from "../pipeline.js";
import type * as pipelineValidators from "../pipelineValidators.js";
import type * as requests from "../requests.js";
import type * as runner from "../runner.js";
import type * as runnerHttp from "../runnerHttp.js";
import type * as validators from "../validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  editValidators: typeof editValidators;
  editing: typeof editing;
  files: typeof files;
  http: typeof http;
  pipeline: typeof pipeline;
  pipelineValidators: typeof pipelineValidators;
  requests: typeof requests;
  runner: typeof runner;
  runnerHttp: typeof runnerHttp;
  validators: typeof validators;
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
