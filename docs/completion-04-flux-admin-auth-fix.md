# FLUX administrative inference authorization repair

Date: 2026-10-31. Local source and test changes only. No credentials/cloud/GPU/weights/paid API/backup/deployment; no customer or live financial data modified.

## Reproduced defect

`completion-04-flux-direct-path-probe.json` captured the actual administrative runner→FLUX adapter→shared transport boundary with only allocation/stop mocked. The runner's administrative attempt lacked the customer production quote/charge/run. Shared transport unconditionally read an undefined quote ID (SQLite bind exception) and would subsequently reject those absent customer records. Earlier tests mocked the entire transport and therefore did not prove this authorization seam. The regression repair does not fabricate financial records.

## Implemented contract

- `admin-inference-authorization.mjs`: FLUX-only, server-owned administrative authorization. A boolean cannot create it. Admission requires the real commissioning test, its consumed dispatchable engine-test-quote, unique approved request command, latest-test link, matching admin owner/private project, exact engine/account/revision, source snapshot and original approval binding.
- `admin-model-test-runner.mjs`: preflights the real normalized FLUX native request at quote and execute, including reference bytes, and binds its digest to the source snapshot. Before any allocation, verifies the consumed commissioning consent; claims a separate `admin-native-authorization` alongside the administrative attempt. Binds it to the actual returned runtime without making production customer quotes/charges/model runs or wallet credits. Cancellation revokes the grant.
- `flux-modal-transport.mjs`: routes only administrative attempts through the dedicated proof; other model administrative flags do not inherit FLUX rights. Rechecks owner, plan, exact native payload/settings/reference data, account credential binding, engine/configuration, approved quote/command, runtime ownership and non-rental origin. Rechecks atomically at provider operation admission to catch cancellation between context validation and dispatch. Read-only result recovery validates its own same-run proof and cannot launch inference.
- Ordinary customer production authorization remains required. Missing quote/charge IDs fail with the bounded authorization error instead of leaking a raw SQLite parameter failure.
- Canonical digests tolerate JSON/JSONB property-order changes; they reject actual content changes. Existing registry deduplication, scoped stop, uncertain-state retention and model-specific resource/licence checks remain active.
- Only FLUX has an independently proved administrative native-request contract in this repair. No claim is made that other models' administrative shared-transport paths are now ready for inference.

## Fresh local evidence

- 73 focused tests passed:13 new real-boundary FLUX tests +12 administrative runner tests +24 commissioning tests +8 platform tests +16 existing FLUX transport tests. No failed tests in the final run. This is test integration, not successful cloud inference.
- 30 neighboring Qwen/Wan/Hunyuan/speech/LatentSync transport tests passed unchanged.
- The new positive path traverses the actual `createEngineCommissioning`, runner, FLUX production adapter, registry, request verification, original PNG storage and actual transport. Only the final Modal control-plane/inference runner is mocked. The image bytes are synthetic fixture PNG, not AI output.
- Negative checks: forged direct snapshot (no consumed consent) is rejected before allocation; missing grant, changed plan/prompt/admin/account credentials, unrelated rental runtime, revoked quote and cancellation immediately before atomic dispatch are rejected with no generation. Customer financial tables stay empty. Duplicate execute returns the original result without another request; same-run recovery performs only a result read.
- Legacy direct-runner tests now explicitly install trusted synthetic commissioning consent fixtures; their old arbitrary caller snapshot is no longer treated as permission.
- Explicit Node ESLint passed for the changed modules/tests after declaring standard Node globals/imports. `npm run typecheck` also passed all four configured scopes. Final parent integration verification records overall build results.

## Still closed before paid execution

This fixes an authorization defect only. It does not impose an actual provider invoice ceiling or validate cloud builds/shutdown. Parent/root budget guard and the user's spending/resource constraints remain independent mandatory gates. Do not run preparation or GPU merely because these tests pass.
