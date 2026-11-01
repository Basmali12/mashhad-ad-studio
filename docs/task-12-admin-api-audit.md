# Task 12 — admin, public API, director and research audit

Audit date: 2026-10-31. Scope: current local checkout; no deployment, model download, provider request, paid resource, cloud modification or browser sign-in was performed. This document records source inspection and mock tests, not a cloud acceptance result or a real rendered interaction.

## Readiness decision

The new backend is present and its focused safety tests pass, but the customer film product is **not ready for an end-to-end release**. Its visible workspace still uses the retired generation route rather than the new director and production engine. Generic model administration has preparation/start/stop controls, but no completed new-model test/publication/customer-binding flow. These are integration blockers, not missing tokens, and should not be represented as a provider outage.

### Confirmed release blockers

1. **Customer workspace does not call the new engine.** `src/features/film/FilmEntry.tsx` renders `FilmWorkspace`. `FilmWorkspace.tsx` uses `project.save` (initial duration 10 seconds), `chat.submit`, `project.launch`, legacy rental and `FilmProject` scene state. It does not call `director.*` or `production.*`. `services/film-engine/engine/film-platform.mjs` blocks legacy rental/launch/prepare/test/publication when `engine.productionAvailable === false`; `api.mjs` makes this false for the real `ModalProvider`; the retired `model-profile.json` is explicitly unconfigured. Enabling the new model adapters does not connect this UI to Tasks 3–11. Do not restore the retired provider to hide this gap.
2. **New model test/publication is not an admin/customer flow yet.** `EngineDefinitions.tsx` offers save, inspect, prepare quote/approval, status and start/stop. The adjacent `AdminCommissioning.tsx` and old slot controls still use `admin.test.*`, `admin.slot.*`, ten-second/native-audio legacy commissioning. Those routes are intentionally blocked for the removed runtime. The generic definition IDs are not bound to a new customer production plan by this UI. A CPU preparation or a ready manifest must not be called a successful generation test or public availability.

### Confirmed defect corrected locally during this audit

Previously `accountSetupModel.ts::linkAndPlan` saved and verified the account, then unconditionally called legacy account discovery and `admin.prepare.quote`. It could show a preparation error immediately after a successful account save, or inspect an unconfigured legacy profile. The narrow correction reads the existing session capabilities after saving. With `genericEngineDefinitions:true` and `legacyProduction:false`, it ends in `linked`, returns no preparation quote, and explains that a model must be defined in the existing engines section. Retry uses the same guard; missing/failed session metadata is not guessed into a paid path. Older servers without the flags retain the previous compatible flow. Token inputs, authentication, layout and rental system were not rebuilt. This correction does **not** resolve the two release blockers above.

## Evidence matrix

| Area | Current evidence | Verdict and boundary |
| --- | --- | --- |
| Account verification | `api.mjs` checks token formats and verifies before persisting; `modal_bridge.py` uses official `modal.Client.from_credentials` and hydrated `modal.Workspace.from_context`, checks expected workspace | Implemented; real credentials/cloud not exercised in this audit |
| Secret protection | `store.mjs` uses AES-256-GCM with random 12-byte IV, per-account AAD and external 32-byte key; `postgres.mjs` reuses authenticated sealing and parameterized SQL | Local mock verifies ciphertext, wrong-AAD rejection, no plaintext token in SQLite file; PostgreSQL encryption inspected, not exercised against a live database |
| Browser secrets | Account password inputs clear before the request; no localStorage/sessionStorage/IndexedDB secret writes found in `src/features/film` or shared contracts; provider subprocess receives explicit credentials via stdin and strips inherited secret environment variables | No secret persistence found in inspected frontend; ordinary request payload carries newly entered credentials to the authorized server as required |
| Unlink | `api.mjs` checks uncertain resources and definitions before deleting; archive copies an explicit non-secret whitelist, excluding credentials/HF secrets | Preserves accounting/history without retaining credential copies; does not claim remote deletion/token revocation |
| Admin authorization | Gateway derives actor from existing membership bearer, exact origins, POST JSON and bounded body; server independently checks admin role; no client actor/account override | Mock HTTP authorization and tenant tests pass; live Google/Clerk/Convex authentication not exercised |
| Namespaces and manifests | Registry derives `models/<modelId>/<engineId>` path, verifies exact account/volume/revision/file sizes/SHA and rejects browser manifests or stale inspections | Ready requires integrity evidence, not filename listing; real Volumes and manifests not examined |
| Cost approvals | Metadata save/inspect cannot allocate; prepare/start need scoped unexpired quotes, explicit approval and paid enablement; model transport rechecks stored definition, manifest and owned production approval/charge | Mock duplicate/concurrency/approval tests pass; published rates and real invoice accuracy not verified |
| Start/stop accounting | Registry meters startup and idle through confirmed stop, keeps unknown stops/reconcile state, blocks automatic replay and cross-run stops | Mock state transitions pass; no real GPU start/stop in audit |
| Monthly/free credits | Provider fields are nullable/unknown when unsupported; manual billing metadata does not prove current official provider credit | Do not promise available promotional credit, expiry or renewal from administrator entries |
| Safe public API | Gateway allowlists request fields and safe output, signed internal bridge, explicit admin operations and opaque Arabic errors | 63 gateway tests pass, including private-path/exception stripping, final QC, SFX, measured synchronization and cost DTOs |
| Strict scripts | Director stores original text/hash separately; strict utterances must equal original source substrings and known speaker/voice IDs; creative drafts are separate | Exact source and revisions covered in tests; model artistic correctness is unproven |
| Long-film planning | Hierarchical outline, chapter scene layout and scene expansion, stable IDs, narrow revision context, preserved successful neighbouring stages | Mock 20-/60-minute structures and 20-minute resume pass; not a generated long film |
| Voice changes | Approved profiles required, explicit changes keep speaker ID and invalidate dependent audio/sync while preserving unrelated image/video outputs | Mock checks pass; no claim of actual dialect, vocal identity or lip synchronization |
| Research | Separate query/quote and approved cost submission; no automatic tool in ordinary script discussion; default 1 search/1600 output tokens, ceilings 2/3000 with expansion approval | Mock actual Responses-format transport verifies tool limits and usage charging once; no actual web request |
| Research provenance | Only provider-observed allowlisted HTTPS sources/citations accepted; invented URLs rejected; fewer than two cited independent approved domains downgrades supported to uncertain | Provenance is not factual/religious certification; no historical event is documented merely from generated evidence |
| Research cache/rights | Customer+project+policy-scoped seven-day cache, canonical query, no extra fetch/charge on valid reuse; web content treated as untrusted, original scenario/summary instructions prohibit full copyrighted works | Isolation/cache/injection-context tests pass; prompt wording cannot by itself guarantee copyright or factual correctness |

## Director case review

- Ordinary chat, a short idea, ready scripts, detailed production prompts, ads and revisions have distinct closed schema intent values. Only idea/advert propose creative mode; script/production prompt select strict mode unless explicitly chosen otherwise.
- Historical and religious requests can propose separately approved research and must retain uncertainty; symbolic scenes are supported without representing generated footage as historical evidence. The tests prove contracts and provenance, not real historic/religious output quality.
- A ready Arabic screenplay is preserved byte-for-byte; production directions do not become speech. Validating a source substring alone does not certify the screenplay or the model's performed words.
- A request such as the fifth scene resolves an ordered stable ID; out-of-range or unknown targets are rejected instead of silently revising the entire film. Local revision context omits unrelated full-film text.
- Voice/dialect routing checks approved engine/profile metadata. A proposed model intent or chat approval cannot authorize GPU, research or paid production by itself.
- Cancellation is explicit and scoped. Saved scenes and completed production stages survive interruption or targeted adoption. An interrupted external text request retains uncertain accounting and is followed rather than replayed. These states need an actual new customer UI before customers can use them.

## Admin clarity recommendations (not a redesign)

1. Retain the verified-account versus model-preparation distinction; the new linked status now does this without falsely reporting weights ready.
2. Keep the existing engines form, but show/apply each adapter's recommended resource profile when selecting its model. Current generic defaults (RTX PRO 6000, CPU 4, RAM 96) do not match speech adapters' fixed smaller profiles and can produce avoidable compatibility blockers. Do not silently change a running definition.
3. Distinguish software installed, manifest ready, deployment ready, runtime running, generation tested and published. Current labels must not imply these are interchangeable.
4. Retire or clearly disable the old commissioning controls while the new test/publication integration is pending. Avoid sending the operator back to a dead legacy preparation route.
5. Keep actual customer costs, estimated windows and unknown provider invoices distinct. Null provider/network/build costs are unknown, not zero; no fabricated remaining free credit.

## Fresh local checks

- `node --test` over engine-accounts, engine-registry, director-story, director-research, director-research-flow, production-director, director-structured and director-adoption: **69 passed, 0 failed**.
- `npm run film:gateway:check`: **63 passed, 0 failed**.
- `npx vitest run src/features/film/AccountSetup.test.tsx`: **11 passed, 0 failed**, including generic onboarding never touching retired inspection/preparation, guarded retry and failed capability read preserving the saved account.
- `npx tsc --noEmit`: passed after onboarding change.
- ESLint of the three changed onboarding files: passed.

The integration tests use temporary local stores, synthetic encrypted credentials, fake fetch/provider runners and no real inference. SSR inert rendering is not proof of click/touch/mobile behaviour. No complete production UI/browser walkthrough, real model generation, cloud preparation, invoice measurement or deployment was performed. Parent/root owns the remaining full-project checks and final readiness report.
