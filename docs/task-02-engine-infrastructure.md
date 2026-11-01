# Task 02 — Model-neutral engine infrastructure

Local implementation, 2026-10-31, branch `codex/ltx-film-engine-integration`.
Scope: account/GPU administration only. No production deployment, model
installation, weights, cloud/GPU call, paid provider request, backup, restore
point, DNS change, account removal or historical wallet rebilling.

## Changed responsibilities

- `shared/engine-catalog.ts`: eight immutable, inactive public descriptors.
  Sources and remaining version/resource/license decisions are recorded in
  `task-02-model-sources.md`. A descriptor is not an installed model.
- `services/film-engine/engine/engine-registry.mjs`: independent persisted
  definitions per model/account, resource configuration, storage namespaces,
  trusted manifest checks, quotes, command identities, lifecycle and metering.
- `film-platform.mjs`: existing authenticated `admin.engine.*` dispatch,
  read-only status handling and Arabic safe errors. Existing customer wallet,
  rental and OpenAI debit implementation stays in place.
- `api.mjs`: account credentials cannot be changed/unlinked while a generic
  runtime is unconfirmed; definitions prevent dangling account unlink.
- Shared/engine contracts, gateway schemas/sanitization and paid-request
  policy: accept only explicit documented fields. No client repository URL,
  manifest, secret or activation flag is accepted by definition save.
- `src/features/film/EngineDefinitions.tsx`: small registry section inside the
  existing admin engines tab. Customer layout, navigation, files, scheduling
  and current account-link form are preserved. No new runtime dependencies.

## Persisted records

Existing encrypted Store/PostgreSQL generic records are reused; no migration
or database connection was run. New kinds: `engine-definition`,
`engine-inspection`, `engine-quote`, `engine-command`, `engine-runtime`,
`engine-runtime-history`. Runtime history is per run, not overwritten by the
next session. Account tokens remain in the existing AES-256-GCM envelope with
account-bound authenticated data. Public responses never include credentials.

Each engine has a server-generated `models/<modelId>/<engineUUID>` prefix.
Definitions can share an account/Volume without sharing readiness or runs.
The file contract fingerprint binds engine, account, configuration revision,
resources, version, Volume, prefix and immutable manifest. Late inspection
cannot overwrite readiness after an account/settings change.

The legacy account `activated` bit described retired weights and is not
required to save a new inactive definition. Account linking still verifies
the API token before saving the encrypted credentials. New model readiness
comes exclusively from its own trusted manifest and storage verification.

## Operations

Administrator only:

- `admin.engine.models`, `admin.engine.list`
- `admin.engine.save`
- `admin.engine.inspect`, `admin.engine.status`
- `admin.engine.quote` (`action: start | prepare`)
- `admin.engine.start` (`id`, `quoteId`, `requestId`, `approved:true`)
- `admin.engine.stop` (`id`, `approved:true`)

Save/read operations never create a Volume, transfer files or dispatch GPU.
All eight production descriptors are disabled; the default adapter is null.
Quotes honestly return no estimated resource window for an unconfigured
model. Both start and preparation remain blocked, rather than presenting a
mock as successful cloud execution. No preparation executor/new weights are
installed in this phase. The prior generic transfer/cost-approval machinery
remains preserved for an explicitly approved future model integration.

## Trusted adapter boundary for later model tasks

Only server code may inject an adapter. No HTTP setting enables one. An
adapter supplies `profile(definition)` with a pinned manifest, resource
compatibility validator, and scoped `inspectFiles/start/observe/stop` methods.
Tests inject synthetic adapters; the deployed/default path never does so.
Before integration, implement bounded provider startup/idle/runtime limits,
real estimates, recovery observation and shutdown cleanup for the chosen
model. Do not remove the existing paid switch or cost approval.

Manifest must identify model/version/revision and unique safe relative paths,
positive byte sizes and SHA-256 values. Inspection must prove the same
account, Volume, namespace, revision and every exact file hash/size. A size
listing or globally ready account cannot certify another model. No minimum
CPU/RAM/VRAM is invented from parameter count; unknown/incompatible resources
are blockers even if the administrator saves a provisional value.

The adapter must identify each admission by persisted `runId`; start/observe/
stop operate on that run only. Readiness must be a service health observation,
not acknowledgement of submission. To confirm stop, return `cloudStopped:true`,
`activeTasks:0`, and `admissionClosed:true` proving no queued admission can
allocate later. A pending local start additionally prevents final stop.
Recovery may clear that fence only with a trusted `startSettled:true` and
closed admission confirmation. A late-start stop race keeps the meter open
and permits an explicit scoped follow-up stop; no start or paid work is
automatically retried. Observe never allocates resources.

## Accounting and request protection

Start commits its command, consumes its quote and reserves account capacity
transactionally before dispatch. A repeated request ID returns its original
run; a changed binding is rejected. One quote cannot pay for two starts.
An ambiguous dispatch retains the run/capacity and requires observation;
failure is not proof of shutdown. Reconfiguration is blocked while resources
are unconfirmed. Existing jobs/rentals also block conflicting admissions.

Meters reuse integer-microdollar `film-money.mjs` arithmetic. Startup, idle,
failure and stop latency continue from dispatch until confirmed stop, with
provider-recorded cost separate from customer-rate estimate. Existing
customer debit/credit/expiry/AI usage code is preserved, not duplicated.
The new registry does not debit a second admin wallet. Renting or generating
with new model definitions stays disabled until a future installed adapter
is connected to the existing wallet/rental service and tested; saving a price
does not publish an engine to customers.

## Local verification record

- TypeScript project checks and ESLint pass.
- Customer and separate admin production builds pass locally.
- Frontend: 687 tests pass; includes 4 registry rendering/disabled-state tests.
- Gateway: 29 tests pass, including schema, roles, explicit approval,
  nullable settings, response redaction and ambiguous request handling.
- Backend: engine registry and account onboarding tests cover encryption,
  duplicate accounts, admin authorization, inactive definitions, isolation,
  exact manifests, approval/paid switch, concurrency, quote consumption,
  startup/idle/stop metering, original-run replay and both inspection/start
  races. Full backend suite: 178 tests pass (14 new registry/account tests).
- Python: 26 tests pass; transfer image-order validation reports
  `SOURCE_AND_DESTINATION_IMAGE_ORDER_VALID_NO_CLOUD`.
- Shared/service contracts match byte-for-byte; `git diff --check` passes.

Every provider response in these tests is mocked. No live Modal account,
PostgreSQL deployment, provider availability, actual model VRAM, installation,
transfer, GPU readiness or customer production run is claimed as tested.
Node emits its existing SQLite experimental-feature notice; no failed checks.

Future service packaging must include the root `shared/engine-catalog.ts`
at the correct relative path and use the existing Node >=24 runtime.
Copying `services/film-engine` alone is insufficient. No packaging/deployment
was performed in this local-only task. Task 03 was not started.
