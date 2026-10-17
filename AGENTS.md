# Mashhad / Iraq AI Studio — project map

This directory (`outputs/ad-studio`) is the application and Git root. Preserve the existing React + TypeScript + Vite + Convex + Clerk project. Do not rebuild it or replace working features.

## Where to work

| Area | Frontend files under `src/` | Server contracts (keep entry-point names) |
| --- | --- | --- |
| App / navigation / PWA | `main.tsx`, `app/app-shell.tsx`, `app/settings-page.tsx`, `app/app-install.tsx`, `app/app-update.tsx`, `app/release-check.ts` | Existing service-worker/update contracts |
| Auth | `features/auth/publishing-root.tsx`, `personal-root.tsx`, `account-settings.tsx` | `convex/auth.config.ts`, `access.ts`, `publishingUsers.ts` |
| Buffer | `features/buffer/buffer-accounts.tsx`, `personal-key.tsx`, `connection-api.ts`, `legacy-connections.tsx` | `publishingBuffer*.ts`, `reelsBufferBinding.ts` |
| Media | `features/media/bunny-media.ts`, `upload-ticket.ts`, `video-player.tsx`, `protected-media.ts`, `media-disk-cache.ts` | `mediaAssets.ts`, `publishingUploadTickets.ts`, `reelsStorage*.ts`; `worker/bunny-storage.ts`, `reels-storage.ts` |
| Library / publication queue | `features/library/library-page.tsx`, `video-upload-form.tsx`, `video-metadata.tsx`, `collection-store.ts`, `collection-cloud.ts` | `publishingCollections.ts` |
| Scheduler / calendar | `features/scheduler/schedule-panel.tsx`, `schedule-model.ts`, `schedule-input.ts`, `queue-plan.ts`, `calendar.tsx`, `calendar-model.ts`, `schedule-list.tsx`, `cloud-jobs.tsx`, `library-task-editor.tsx` | `reelsJobs.ts`, `reelsCalendar.ts` |
| Publishing / history | `features/publishing/publication-status.tsx`, `task-settings.tsx`, `publishing-history.tsx`, `cloud-insights.tsx`, `library-api.ts`, `library-automatic.ts` | `reelsJobs.ts`, `reelsWorker*.ts`, `reelsInsights.ts`; `worker/reels-publisher.ts` |
| Subscriptions | `features/subscriptions/subscription-page.tsx`, `cloud-subscription.tsx` | `reelsBilling.ts`, reservations/ledger/binding enforcement |
| Admin / support | `admin.html`, `src/admin-main.tsx`, `features/admin/admin-app.tsx`, `admin-page.tsx`, `buffer-support.tsx` | `reelsAdmin.ts`, Buffer support operations |
| Site advert | `features/banner/site-banner.tsx`, `banner-media.ts`; `features/admin/site-banner.tsx` | `reelsBanner.ts`; owner-only image tickets; worker public current-banner stream |
| Shared frontend | `shared/api/publishing-session.ts`, `storage-api.ts`, `shared/ui/page-boundary.tsx` | Session is a single shared connection, never duplicate it |

Root `shared/` is distinct from `src/shared/`: it contains browser/server domain contracts (Buffer, signing, quotas, publication metadata, ownership). Keep server-only crypto and Node code out of frontend imports.

`convex/`, `worker/`, and `scripts/` already separate responsibilities well. Keep Convex registered functions, generated APIs, HTTP paths, worker entry points and bundle names stable. Node entry points are `scripts/reels-runner.ts`, `reels-media-server.ts`, `reels-storage-server.ts`; build them with `scripts/build-reels-worker.mjs`.

Root `src/redesign-*.ts`, `data.ts`, `studio-api.ts`, `retired-studio-api.ts`, older styles and the old story/Flow server modules are retained legacy code. They are not an invitation to reactivate generation or delete history. Some legacy APIs still support preserved personal-mode flows. Check consumers before touching them.

## Adding or changing a feature

- Change an existing feature in its current folder; give a new independent feature one meaningful folder.
- Separate UI, API clients, models and types when there is a real responsibility boundary. No empty scaffolding or blanket barrel exports.
- App imports feature UI; feature code uses small documented model/API seams and shared contracts. Do not import feature UI into shared services. Avoid runtime cycles; type-only cross-feature references should remain type-only.
- Keep one implementation of shared logic. Do not copy session, upload, ownership, subscription, rate-limit or publishing rules.
- Update this map whenever a feature is added, renamed or moved; move its tests and update mocks/import paths too.
- Heavy pages use explicit `React.lazy` imports in `app/app-shell.tsx`. The customer app has no admin navigation or admin page import. Admin has its own `admin.html` / `src/admin-main.tsx` entry, separate `dist-admin` build, and administrator-only authentication gate before membership/storage setup. Loading UI is handled by `PageBoundary` without hiding navigation.
- Styles retain their established load order in `main.tsx` and the app shell. Compare desktop/mobile before moving CSS or claiming unchanged appearance.

## Verification

Run the affected tests first, then before completing a phase:

```text
npm run typecheck
npm run lint
npm test -- --maxWorkers=2
npm run build
```

`typecheck` covers frontend/shared, Convex, worker and the three service entry points through `tsconfig.services.json`. If worker files move into subfolders, update `worker/tsconfig.json` (currently `*.ts`) so checking does not silently omit them.

For service-boundary changes also run `node scripts/build-reels-worker.mjs`; this builds only and must not start a worker. Use isolated Convex tests and local provider fixtures; never create real social posts to verify a refactor. Verify local navigation, scheduling, metadata, RTL and phone widths. Measure initial static JS/gzip and deferred chunks rather than treating file splitting as a speed result.

## Sensitive boundaries

- The local `.env` can target live Convex. Verify the target before any Convex command; `convex dev` is not a harmless local check. No deploy, push, cloud mutations, service restarts or real publications without the user's explicit authorization for that work.
- Refactoring does not authorize changes to schema/data, Clerk configuration, Buffer key encryption/locking, Bunny configuration, quotas/subscriptions, send intent/fencing, duplicate prevention, uncertain-result handling or actual publishing logic. Request separate scope when a behavioral change is needed there.
- Never expose tokens, keys, private URLs or customer data in logs, fixtures, source, reports or the browser. Preserve customer isolation, immutable history, ownership, SHA-256 and authenticated/signed media access.
- Commercial publishing remains gated by the existing policy/configuration. Do not enable public subscriptions or use owner credentials as a customer fallback.
- No deleting features, customer records, media, historical receipts or apparently unused code without verifying dependencies and obtaining the necessary user authorization.

Storage availability is not an authentication gate: membership registration/authorization must succeed before rendering the account. A storage probe failure shows a warning while account management remains accessible; media endpoints still enforce their own JWT/ownership checks. The design-only preview explicitly labels disabled account integration.

Standalone admin: `npm run build:admin` uses `vite.admin.config.ts`; deploy its `admin.html` as `index.html` with its own assets at https://scan.iraqaistudio.com/reels-admin/. Customer and admin use the same configured Convex/Clerk environments. The admin gate calls `api.access.allowed` before registration or admin queries. Never restore an embedded admin page in the customer shell. `admin-link.tsx` is preserved compatibility code, not part of the customer app.

Subscription catalog: shared/reels-plans.ts defines the three fixed offers. New choices are requests in reelsPlanRequests, never self-activation. Admin still assigns/renews. SubscriptionGate intercepts customer actions until activation; never apply it to the standalone administrator app. month-board.tsx is the SaaS schedule screen (30 Baghdad calendar dates from startsAt, up to two videos per day). Legacy schedule components and historical records are preserved.
Quota: publishingUploadTickets.begin atomically holds a slot in the active subscription; mediaAssets.recordVerified finalizes reelsUploadUsage by SHA-256 after verification. Pending failures release/expire; accepted usage survives deletion and publishing failure. reelsUploadQuota merges legacy reservations to prevent double charging. Never remove usage records to refund a deleted file, bypass server checks, enable public SaaS, or send real posts as a test.

Local UI preview: npm run dev:preview serves preview.html / src/preview-main.tsx on loopback 43148 using vite.preview.config.ts. It disables env files and server plugins, reuses PlanCards, MonthBoardView and ReelsSettings, and persists only local files/settings in the separate mashhad-month-preview-v1 IndexedDB. Never enter real API keys here or import the preview entry into the production app. Test video persistence on a separate loopback origin to avoid adding fixtures to the user's preview. Normal builds ship index.html only. Source Settings now contains account/Buffer panels and day/night controls; the header has only the Settings action.

Account actions: features/auth/account-settings.tsx exposes a shared AccountSummary and Clerk-backed AccountSettings. Explicit sign-out targets the current Clerk session ID only, preserves media/binding/subscription records, and redirects to the current application entry. Settings navigation and sign-out are exempt from the subscription modal so expiry cannot trap a user. The local preview shows a disabled sign-out control instead of faking an authenticated session.

Per-video account selection: day-editor.tsx / day-editor-model.ts render the day dialog and compute future default Baghdad times. LibraryVideo.channelIds is optional for historical compatibility; new day-editor videos preserve their explicit opted-in channel IDs through collection-cloud and publishingCollections. Server save validates ownership and plan approval; reelsJobs.create rejects channel lists that differ from the video selection. Do not treat header platform icons or local preview channel fixtures as proof of real connected accounts.

Customer layout: app/customer-app.tsx is the production SaaS shell, with shared CustomerHeader used by the isolated preview. Only Schedule (default), Plans and Settings are customer navigation. Account/Buffer/sign-out live in Settings; no customer top account strip. The inactive schedule shows 30 display-only dates with no allowance; SubscriptionGate/server enforcement remain required. Keep the reference layout and do not substitute legacy ReelsApp when deploying.

Admin tabs: features/admin/admin-page.tsx retains overview/support, subscription-activation.tsx uses exact owner-only findUserByEmail plus the existing assign mutation, ban-panel.tsx uses access without deleting users. usersPage remains paginated. publishingUsers.email is optional and indexed, sourced only from the signed Clerk identity when emailVerified is true; never accept it from a customer form. Clerk custom session claims must retain aud=convex and include email, email_verified and name. Installation uses AppInstall with public/admin.webmanifest scoped to the standalone admin route. No real activation/ban is allowed just to test the UI.

Admin branding: approved raster source is design/admin-icon/mashhad-admin-icon-v1.png. public/mashhad-admin-icon-v1-{180,192,512}.png are deterministic size variants. Only admin.html, admin.webmanifest and AdminApp reference them. Keep the customer mashhad-icon assets and customer manifest unchanged. AppInstall accepts an optional iconSrc; the customer default keeps its download glyph.

## Published-media retention

`convex/reelsRetention.ts` owns 48-hour retention after all real destinations confirm publication. Result/observe hooks arm an exact scheduled action; the indexed retry cron only processes failed cleanup. `worker/reels-storage.ts` deletes one owner-scoped object through a fenced internal bridge. Both services require `REELS_RETENTION_ENABLED=true`; keep delivery/history/usage rows. Dry runs, unknown results, new references, legacy Convex originals and oversized dependency sets fail closed. Never run disposable cleanup probes against customer media.

Admin overview: `features/admin/admin-overview.tsx` displays the owner-only on-demand snapshot. `shared/admin-overview.ts` counts real jobs once across destination receipts using Baghdad dates; raw delivery counts and existing support/plan/budget controls stay inside collapsed advanced diagnostics. No provider calls, live polling, schema changes or publishing switches belong in this summary.

Direct infrastructure metrics: `worker/reels-infrastructure.ts` reads Bunny object listings and host disk/RAM/spool sizes. `/api/admin-infrastructure` requires the server bridge secret; only the owner-authorized Convex snapshot calls it. No secrets/paths/file names in responses. One-minute in-memory cache, single-flight and bounded GET-only scans; partial/unavailable readings must never look like exact zero. `features/admin/infrastructure-cards.tsx` separates actual provider/host readings from registered database bytes. No scheduled polling or storage mutations.

Customer account linking shows only Personal API Key through buffer-accounts.tsx / personal-key.tsx. Historical OAuth backend/auth records remain untouched; no OAuth fallback in the 30-day customer board. personal-channels.tsx groups real key channels into four platform cards; platform-status.ts and platform-connections.tsx drive connected names and slash marks. Header settings toggles back to schedule on its second click. Never infer connected state from a subscription plan or platform catalog.

TikTok display labels: shared/buffer.ts requests Buffer Channel.displayName; worker/buffer-personal-preparation.ts prefers its trimmed nonempty value for TikTok only, otherwise falls back to name. Never substitute a screenshot name or change stable channel/account IDs. Existing connections refresh through the locked personal sync action, not reconnect/key replacement.

Schedule time guards: month-board keeps a local clock (no server polling); past empty dates are disabled and historical videos stay viewable read-only. day-editor disables elapsed Baghdad clock options and stale draft saves. publishingCollections preserves unchanged historical rows but rejects edits after their original publishAt; validatePlacement remains the authoritative server check for new/future placements. Subscription startsAt/30-day numbering never shifts when a day is unused.

Day opening: month-board creates the first draft immediately for an empty future day. day-editor shows saved originals in playback mode (Player plus edit/delete actions); editing requires a future unlocked time. Delete means remove from the schedule with explicit confirmation, preserve file/history/quota, cancel queued/retry deliveries through existing reelsJobs.cancel first, and fail closed for in-flight or uncertain results. publishingCollections rechecks removal atomically to prevent orphan active deliveries. Never infer storage deletion authorization from removing a calendar item.

Reels duration: shared/reels-video.ts sets an inclusive 180-second limit. features/media/reels-video.ts reads local metadata before upload reservations; month-board preflights all new files and bunny-media applies the guard to other upload callers. worker/reels-video.ts probes the received local file with FFprobe before Bunny PUT/record acceptance; unreadable, unknown and oversized durations fail closed. The storage host must provide ffprobe on PATH or MASHHAD_FFPROBE_PATH before deployment. Existing stored files/history are not deleted or silently changed by this upload guard. Build the worker bundle after changes; never start live services or write provider files as a test.

Customer branding: customer-header uses the existing customer mashhad-icon asset in a CSS two-sided rotating coin; preserve reduced-motion support and the standalone admin branding. month-board renders the gold crowned VIP label only during the active subscription dates and never based on remaining quota or a selected plan. This is display-only and must not grant subscription rights.

Site advert: features/banner/site-banner.tsx shows the image-only dismissible opening overlay outside the customer login gate; never mount it in the admin app. features/admin/site-banner.tsx manages the owner-only Advert tab. reelsBanner owns the singleton configuration, optimistic revision and public active revision; the image stays in Bunny, never inline in Convex. Owner-only image tickets use publishingUploadTickets.purpose=site-banner, expire after ten minutes, and never reserve/charge video quota. worker /api/site-banner serves only the currently approved revision via the private bridge; all other Bunny media stays authenticated. Hiding preserves the current image. Successful replacement removes only the retired image and its media record after confirmed Bunny deletion; audit history stays preserved. Raster images only, <=2 MB and landscape <=6000x3000; validate with FFprobe before storage. verification/site-banner-preview.html is a local demo, not a live advert. Additive schema changes need backend/service deployment before customer/admin clients; no live upload or activation just to verify code.

Calendar queue handoff: publishingCollections.save calls the shared reelsJobs.createJob helper in the same mutation for changed future reviewed Bunny placements with explicit channels. Blocked service/production personal-key policy creates paused reviewRequired jobs, never silently arms them when flags change. Existing unchanged or elapsed placements are not backfilled/replayed. Upload usage and publish reservation share the same asset hash so quota is counted once. Queued real deliveries are claimable within 120 seconds before dueAt; the private context passes scheduledAt and publisher uses Buffer customScheduled/dueAt until that deadline, shareNow only once due. Administrative single-test and dry-run timing stay unchanged. Receipt observation starts after the scheduled deadline; uncertain results are never resent. Customer cards distinguish saved-only, paused, queued and review states. Cancel permits paused attempts=0 with no provider receipt; server rejects any ambiguous cancellation. Do not enable flags or commercial personal-key use just to test this path.

Advert optimization/cache/replacement: features/banner/optimize-banner.ts converts accepted images to WebP before ticket/upload (<=1600x900, <=250 KB, bounded encoding passes). No video quota is charged. SiteBannerView keeps its overlay hidden until image load succeeds. Worker serves only the active revision with immutable browser cache and ETag/304; other media/error responses stay no-store. A revision changes on admin saves so replacement uses a fresh URL. reelsBanner.save schedules only its previous owner image for deletion, with deletionPending/retentionFence and bounded shared-reference checks; a pending image cannot become current again. Private /api/banner-delete revalidates retired image authorization through Convex before Bunny DELETE, and only confirmed removal purges that mediaAssets row. Current images, video records and audit history stay untouched. Cleanup retries are bounded; do not confuse implementation tests with live image deletion proof. Deploy storage service before backend to make this endpoint available before replacement cleanup runs.

Owner real publishing: reelsPublishingPolicy permits hosted personal-key sends only when REELS_OWNER_PERSONAL_ENABLED is true, the authenticated subject matches OWNER_SUBJECT, and the binding account matches REELS_OWNER_BUFFER_ACCOUNT_ID. PUBLISHING_SAAS_ENABLED must remain false; commercial personal keys stay unapproved. REELS_LIVE_START_AT is a required cutover: job createdAt and dueAt must be at/after it. New collection saves queue automatically when send/runner gates are active; earlier paused jobs never auto-arm. guardJob rechecks policy before claim/context/intent and worker credentials recheck before key decryption/status. The reels-publisher systemd service uses only the Convex worker bridge secret; Buffer credentials stay encrypted in Convex and never fall back across users. Enabling real sends and starting/restarting this service are live publishing changes requiring user authorization.
