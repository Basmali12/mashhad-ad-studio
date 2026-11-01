# Task 03 — New production workflow (local only)

2026-10-31, `Basmali12/mashhad-ad-studio`, branch
`codex/ltx-film-engine-integration`. This phase implements the workflow and
contracts. It does not install, load or run any inference model. No production
deployment, database migration, external AI request, paid operation, backup,
restore point, DNS change or deletion of user/account/financial data occurred.
The retired engine's inference/audio/continuation code was not reused.

## Modules and ownership

| Module | Responsibility |
| --- | --- |
| `production-plan.mjs` | Pure validated storyboard, Character Bible, routes, chapter/scene/shot coverage and deterministic DAG |
| `production-engine.mjs` | Tenant ownership, durable states/attempts, planning boundary, quote/approval, sequential worker, progress, retry/resume/reconcile/cancellation |
| `production-models.mjs` | Fixed image/edit/video/audio contracts, registered definition/version/resource readiness, scoped GPU lifecycle, input/output receipts; no model implementation |
| `production-billing.mjs` | Existing wallet lot arithmetic, scoped reservation, usage settlement, unknown holds and outstanding liability |
| `production-renderer.mjs` | Edit decisions and timed soundtrack placement; bounded progressive groups; no lip-sync/voice-cloning claim |
| `production-assembly.mjs` | CPU FFmpeg concatenation/normalization, silent video inputs, timed original narration/effects, content-addressed resumable groups |
| `production-artifacts.mjs` | Canonical server paths, streaming final copy, hash/full decode/AV/duration verification, final media index |
| `shared/production-contracts.ts` | Browser-safe public states, timeline/bible/quote/progress/final metadata |

Existing generic Store/PostgreSQL `iff_records` is reused. New record kinds
include `production-project`, `production-character`, `production-stage`,
`production-attempt`, `production-intent`, `production-quote`,
`production-settings`, `production-charge`, `production-model-run`,
`production-edit`, `production-asset`, `production-assembly` and its intent,
`production-artifact-intent`, `production-result`. MP4/audio/image payloads
are files, not database blobs. No live PostgreSQL or server was contacted.

## Workflow

Create story → analyze → validated storyboard → awaiting approval → queued
work → character/reference images → scene images → animation → exact-text
voice → edit/sync decisions → effects → chapter merges → final merge → save
to the existing customer's files. Analysis/planning have separate successful
checkpoints. Failed validation is not cached as a successful plan.

Project/stage states use draft, planned, awaiting_approval, queued, running,
completed, failed and cancelled as applicable. Request identity and stage IDs
are independent of titles. Completed stages are not selected for execution
again. Explicit retry requires a fresh approved quote and a definitively
failed, reconciled stage; successful dependencies remain intact. Unknown
provider outcomes keep both accounting holds and resource scope, prohibit
automatic retry, and can be followed through a trusted `observeResult`
adapter and server-only `reconcile`. Reconciliation cannot dispatch inference.

`run` and `configure` are trusted server-worker/admin capabilities only.
There is no public run, arbitrary planner injection, model enable flag or
client-supplied account/Volume/URL/path route. The public authenticated
operations are create/get/list/plan/quote/approve/retry/cancel. Existing bridge
authentication derives customer ownership on the server. Default execution
is disabled, model adapters are absent and all Task 02 catalog entries stay
inactive. The local planner injection explicitly declares no billing; no
OpenAI client is imported or called by the new production workflow.

## Duration, identity and narrative

Supported plan horizon: 10,000–3,600,000 milliseconds, not a 60-second cap.
Future expansion is isolated in plan validation rather than inference code.
Chapters/scenes partition the film; shots reference them and exactly cover
the requested timeline. Short shots, multiple shots per utterance and a
continuous utterance crossing chapter boundaries are supported. Planning
requires explicit event IDs; duplicate dialogue/events/prompts are rejected
unless an intentional repeat references the previous occurrence.

Characters retain stable IDs, names, descriptions, age, face/body, wardrobe,
prop IDs/descriptions, angle-specific references, relationships and pinned
voice ID/engine/locale. Changing location is a shot decision, not a new
character. Reference IDs are validated against tenant-owned retained assets.
Pure validation does not prove a reference depicts the right person or that
an inference model will maintain faces, props, dialect or lip motion.

Routing defaults: new image FLUX, reference edit Qwen, animation Wan,
Hunyuan as explicitly configured alternate, Habibi MSA/IRQ/EGY for supported
locale, Audar for its declared supported route. Voice is pinned per character
and cannot silently switch. Fallback metadata never launches an automatic
second paid attempt. Administrative bindings/settings are stored separately
and frozen into a plan/quote; changed definition/version/resource revisions
invalidate execution instead of silently routing to another account/model.

## Audio and progressive FFmpeg assembly

Voice is generated once per utterance, not once per shot. Audio is kept in
the asset ledger and placed using absolute story timestamps. Chapter slices
advance the source offset rather than replaying the beginning of a line.
Explicit narration replaces original clip audio; the final concatenation
preserves the already mixed chapter soundtracks rather than mixing voices
again. Timed SFX use owned audio assets. Missing SFX assets block preparation;
descriptions alone are not falsely reported as generated sounds.

Actual video and audio durations are checked. Overlong narration requires a
timing replan; it is not silently cut or sped up. These are edit/AV alignment
contracts, not an assertion of generated lip synchronization. The installed
future planner must schedule events and dialogue against actual audio
measurements; this phase tests those boundaries with controlled assets.

FFmpeg input batches are bounded to 64 videos. Large chapters can assemble
and reuse nested groups, then chapter outputs become final film inputs.
Files are content-addressed by ordered source hashes/settings/audio tracks.
Successful groups are verified/reused after interruption, never regenerated.
Current safety bounds on simultaneous audio tracks and storyboard collection
sizes remain validation/resource limits; a long film should use bounded
chapters rather than a single enormous filter graph. The duration horizon
does not promise an hour-long GPU allocation or one-pass inference.

New final files use `film-exports/<project>/<sha256>/merged.mp4`. Large output
copy and hashing are streamed; the normal one-hour path does not load the
whole film into RAM. Symlinks, foreign ownership, substituted bytes, stale
save attempts and late commits after cancellation are rejected. A final
verified mirror is indexed into the existing final-only `film-media` library,
with current retention/preview/download/delete behavior. No per-shot customer
preview or new design was introduced. A pending final media index is retried
as the save stage only, not as a new generation.

## Approval, finances and lifecycle

No debit before approval. Planning/listing/quotes cannot allocate a GPU.
Each stage reserves from the existing `film-credit` lots immediately before
admission, then records submitted usage and settles once. Refunds keep the
original credit expiry. Uncertain calls retain holds across restart; recorded
overages become explicit liabilities, never negative balances or silent loss.
The same wallet remains available to existing rentals/AI usage; no parallel
customer balance or replacement financial ledger was created.

Uninstalled model cost is null, not an invented zero. Local renderer stages
do not dispatch an additional billed provider operation (the existing server
itself still has infrastructure cost). Future model estimates/receipts must
include all GPU startup/idle/teardown resources. An inference failure after
GPU admission cannot claim zero merely because no frames were produced.
Quote approval expires after five minutes; an approved execution window is
bounded to 24 hours without extending wallet lot expiry. Re-approval, if
needed later, must preserve prior successful stages.

Registry stop receives the expected run ID inside its transaction, so a late
stop cannot affect another customer/replacement run. Cancellation passes an
abort signal and scoped cancellation capability, stops new admissions, and
does not claim confirmed cloud shutdown or free funds from an unknown
result. Worker close stops subsequent admissions at a durable boundary.

## Verification and remaining integration boundary

- Mock 60-second and 600-second full films pass, including chapter merges,
  fixed character/voice IDs, genuine progress events, checkpoint resume,
  one voice across several shots and final receipt.
- Mock stage failure retries only that stage under a fresh approval. Unknown
  submission, stale quotes, depleted funds, cross-tenant access, repeated
  requests, worker close, cancellation and read-only result adoption are tested.
- Existing engine/account/wallet suites remain intact. New model adapter tests
  bind tenant/project/attempt/account/definition/version/run and require total
  resource accounting; expected-run stop has a regression test.
- FFmpeg tests use tiny synthetic local media only: real full AV decode,
  silent-video concatenation, final file verification and a continuous
  changing-frequency audio fixture across two clips (not repeated audio).
- Frontend: 687 tests pass. Gateway: 36 tests pass. TypeScript/ESLint,
  customer/admin builds and worker bundles pass; no service is started.
- Full backend suite: **255 passed, 0 failed, 0 skipped**. Python: **26 passed**,
  plus transfer image-order validation without cloud. Shared service/browser
  operation contracts match exactly; final `git diff --check` passes. A
  Windows CRLF normalization notice and Node's existing experimental SQLite
  notice are informational, not failed checks. This is local SQLite/mock/CPU evidence, not a live Modal
  inference, PostgreSQL deployment or 60-minute real generation benchmark.

Model installation, actual story/image/video/TTS inference adapters, measured
quality/dialect/VRAM/cost validation and cloud worker deployment are intentionally
not performed in Task 03. Existing website design, credentials, users, media,
wallet receipts, scheduling, integrations and domains remain preserved.
Task 04 has not started.
