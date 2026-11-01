# Completion 03 — npm security evidence

Date: 2026-10-31. Local only; no deployment, API inference, model weights or GPU.

## Fresh advisory evidence

- Official GitHub advisory: https://github.com/advisories/GHSA-mrhx-c7xc-m3w5 (reviewed 2026-10-31). Package range <4.6.6; patched 4.6.6.
- Official fix: https://github.com/colinhacks/zod/commit/a0ebf97 — v4 size bounds before element parsing; https://github.com/colinhacks/zod/issues/6653 records unresolved v3 path. Therefore the `zod/v3` compatibility export was deliberately NOT used.
- Upstream IMG.LY metadata https://github.com/imgly/background-removal-js/blob/main/packages/web/package.json still reports1.7.0 and declared Zod^3.23.8. Its distributed ESM actually bundles Zod3.24.2. A dependency override alone would hide the audit entry without removing embedded code.

## Scoped fix

- package.json/package-lock.json pin IMG.LY1.7.0 and Zod4.6.6; scoped IMG.LY dependency override resolves all installed Zod paths to4.6.6.
- scripts/background-removal-security.ts installs a Vite pre-loader in customer/admin inherited config and dedicated preview config. It requires the exact upstream ESM SHA256 `1bac0a7afd5d6a32bca8032f5e14f292e9b800fee3f2e9931fe79ee70bd9a7fd`, removes only the bundled validation block and uses official patched Zod4. Configuration migrates v3 callback validation and prefault semantics. Every byte beginning at upstream `// src/inference.ts` remains unchanged. Package notices stay intact. Changed upstream bytes/schema fail closed for review.
- Never describe the raw upstream node_modules package as patched: the supported application consumer is this loader. Do not add direct server/Node imports of IMG.LY; that would bypass the Vite seam. The repository currently has one production import, in src/redesign-visual.ts, through this build path.
- Fresh audit additionally found Vite high/moderate and minimatch moderate advisories beyond the previously recorded Zod chain. Vite updated within6.x to6.4.5. minimatch11.0.1 overrides the compatible public matching API used by ESLint/config-array/typescript-estree; host Node24.14.1 satisfies its engines. Full lint/build regression remains mandatory when changing the override.

## Evidence

- Before:14 npm entries (3high,11moderate); see completion-03-security-audit-before.json for exact advisory IDs/dependency paths.
- After: `npm audit --json --fetch-timeout=20000 --fetch-retries=0` exit0, zero vulnerabilities.
- Production-only: `npm audit --omit=dev --json --fetch-timeout=20000 --fetch-retries=0` exit0, zero vulnerabilities.
- 14 focused tests pass: real migrated upstream config defaults/aliases/invalid inputs, collection-bound rejection before any element validation, exact vendorhash failure, actual in-memory Vite build with original removeBackground export and patched validation, unchanged inference bytes, existing visual workflow and CPU PNG/transparency operation (ONNX boundary mocked).
- `npx eslint scripts/background-removal-security.ts scripts/background-removal-security.test.ts src/redesign-background-removal.test.ts vite.config.ts vite.preview.config.ts`: exit0.
- `npm run build`: exit0; all four TypeScript scopes then Vite6.4.5 production build passed.
- Native background-removal ONNX inference was not executed and no segmentation/model data was downloaded. Unit/in-memory build evidence does not prove actual image quality.
- Full suite/lint/admin build integration results are recorded by the coordinating Completion03 verification record.
