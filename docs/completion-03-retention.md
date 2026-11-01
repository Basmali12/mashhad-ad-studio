# Completion 03 — internal production media retention

Date: 2026-10-31. Local implementation and synthetic fixture files only. No production data was swept, no GPU/cloud/API job was dispatched, no model weights, accounts, financial records or backups were touched.

## Confirmed changes

- `services/film-engine/engine/production-media-retention.mjs` extends the existing seven-day policy to `production-assets/<project>/<asset>` and `production-groups/<project>/<group>/<fingerprint>`, including known internal original/preview/native/alignment/audio files and managed temporary names. The current platform already calls `film-media-library.cleanup` on its media sweep; that method now invokes the internal collector. No new scheduler, endpoint, design or account workflow was introduced.
- Expiry requires the full retention interval after the latest known project/result/asset timestamp and file modification time. Unstamped orphan media receives a full rollout grace interval from a durable policy activation timestamp. Unknown filenames/directories, unknown project ownership and conflicting ledger ownership are deferred rather than interpreted as disposable data.
- Every draft/planned/running/failed/needs-review/resumable project remains protected. Terminal projects are also protected while a queued/running/uncertain/reconciling production stage, attempt, cloud job, administrative test or writing intent exists. Final-result/merge timestamps extend internal retention so an in-retention final film keeps its source lifetime intact.
- Explicit plan reference IDs, Character Bible references, retained-reference bindings, voice profiles, imported sound-effect library records and verified administrative test evidence are protected. Their source/root lineage is retained transitively. Voice/reference/model/export directories are outside this collector's namespace. Financial records, project/story history, attempt receipts and source hashes remain intact.
- Each delete decision is revalidated under the store transaction immediately before filesystem unlink. Only known regular files within verified non-symlink ancestors are removed. There is no recursive remove over caller-supplied paths. Active production can win a queued transaction and defer collection. Metadata is removed only for the matching owned asset/group; compact SHA-bearing removal tombstones and audit entries retain idempotent expiry evidence.
- Repeated/concurrent cleanup calls share one sweep; missing files after interrupted unlink are safely reconciled from owned metadata, without regenerating media. Per-unit failures remain deferred and are alertable.
- Existing final-export/manual deletion now checks new Production activity as well as legacy jobs, and rechecks after the durable deleting intent inside the physical-deletion transaction. It cannot delete an export while a newly started Production run is active. A planned project alone does not prevent the owner manually deleting a finished export; its internal resumable sources remain protected.

## Fresh evidence

Commands (FFmpeg points to the existing local executable; no install/download):

```text
node --test --test-concurrency=2 services/film-engine/tests/production-media-retention.test.mjs services/film-engine/tests/media-retention.test.mjs services/film-engine/tests/production-artifacts.test.mjs services/film-engine/tests/production-assembly.test.mjs services/film-engine/tests/final-production.test.mjs services/film-engine/tests/commissioning-platform.test.mjs
npx eslint --no-ignore services/film-engine/engine/production-media-retention.mjs services/film-engine/engine/film-media-library.mjs services/film-engine/tests/production-media-retention.test.mjs services/film-engine/tests/final-production.test.mjs
```

46 tests passed, 0 failed (10 new retention tests + existing legacy retention/artifact/FFmpeg/final-media/platform checks). Focused original retention coverage is 15 passed, 0 failed. New tests cover TTL boundary, untouched current exports and reference roots, source-chain retention, cross-project explicit references, active/uncertain/intents, tenant ownership collisions, symlink escape, unknown files, crash/restart, concurrent sweeps and a newly started production race.

Two pre-existing final-production fixtures bypassed the production coordinator and left the project `running` after directly committing a completed export. The stronger safety guard correctly rejected deletion. Those fixture workflows now explicitly record coordinator completion before asserting owner deletion; the production guard was not weakened to accept a running project.

## Operational limits

This is a local code-and-fixture verification. No live PostgreSQL sweep, multi-process service deployment, real customer cleanup or storage-capacity measurement was performed. Explicitly retained references and resumable failed projects are deliberately not reclaimed automatically. Unknown or inconsistent ownership is deliberately deferred; operators must resolve it rather than forcing deletion. Current saved final films are governed by the unchanged existing seven-day customer-media policy.
