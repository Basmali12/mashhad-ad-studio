# Mashhad Buffer integration

The code adds per-customer OAuth connections and explicit MP4 publishing for Facebook Pages, Instagram Reels and TikTok. Existing Meta connections remain intact. No purchase or publication is performed by setup.

TikTok channels connected in the customer's Buffer organization are imported with “تحديث الحسابات”. Disconnected or locked channels remain excluded. The interface labels TikTok separately; TikTok video metadata uses `tiktok: { isAiGenerated: true }`, without Facebook or Instagram fields. Connecting or refreshing channels does not submit a post. TikTok publishing requires the same explicit video, caption, destination and approval as the other platforms. Connection visibility has been verified; no TikTok publication test is implied.

## Register the app

In Buffer Settings → API → App Clients, register Mashhad with these scopes:

- `account:read`
- `posts:read`
- `posts:write`
- `offline_access`

Prefer a public client with mandatory PKCE; no client secret is needed. The server still stores tokens encrypted. Register the exact HTTPS return address:

`https://capable-cuttlefish-575.convex.site/buffer/callback`

For another deployment use its own Convex site URL. Local frontend origins can be used because the callback is HTTPS on Convex and returns to an explicitly allowed frontend origin. No browser certificate warning bypass is necessary.

## Activate after authorization

1. Set `BUFFER_CLIENT_ID` on the approved Convex deployment. A confidential client additionally needs `BUFFER_CLIENT_SECRET` in the server secret store. Never put tokens or secrets in the client or chat.
2. The existing `META_TOKEN_KEY` is reused for AES-GCM encryption with the customer subject as authenticated context. Do not rotate it during setup. `CONVEX_SITE_URL` and `CLIENT_ORIGINS` must match the deployment and frontend.
3. Deploy the new Convex schema/functions after approval; it is shared with the live app. Regenerate the Convex API declarations during this step.
4. Only then set `VITE_BUFFER_ENABLED=true` for the local preview. The default pending card makes no call to undeployed functions. Frontend publication remains a separate release step.
5. Customer clicks Connect Buffer, signs in and approves the listed scopes, then returns to Mashhad. Add social accounts in Buffer and use Refresh Accounts to fetch them.
6. Verify customer isolation, callback cancellation, session expiry, channel refresh and reconnect. Actual posting needs separate approval of a specific video, caption and destination; do not send a test post just to verify setup.

## Operational behavior

- Stored access/refresh tokens and PKCE verifier are encrypted and excluded from public queries, URLs and error messages.
- One-time, ten-minute OAuth state and allowlisted return origins prevent replay and unsafe redirects.
- Refresh tokens rotate under a database lock. A failed/uncertain refresh is not retried with the same refresh token; require reconnect.
- Publication requires a customer-owned MP4 and explicit approval. A durable immutable idempotency key plus an atomic claim prevent duplicate dispatch.
- Provider response loss is marked uncertain and never automatically re-posted. Accepted is distinct from published; customer can refresh status without reposting.
- Disconnect removes Mashhad authorization data and pending OAuth state. Revoke the grant in Buffer to remove provider-side authorization too. Already accepted posts may still publish in Buffer.
- The current release covers Facebook and Instagram. TikTok and daily automated scheduling are outside this change.

## Scheduled publication and request measurement

- The publication panel supports immediate sharing or a specific test schedule seven minutes after confirmation. The backend uses `customScheduled` and an ISO UTC `dueAt`, rejects dates less than five minutes or more than thirty days away, and keeps the approved timestamp immutable on retries.
- Every outbound Buffer request is recorded before dispatch with its customer, operation, optional post ID, and endpoint category. HTTP result and numeric rate-limit policies are recorded after the response. No authorization headers, tokens, OAuth codes, response bodies, or quota partition keys are persisted in the request ledger.
- Post counters distinguish GraphQL from OAuth requests. A counter is an outbound attempt; a missing HTTP response is not proof the provider received or charged it. Compare successive provider `RateLimit` remaining values to confirm quota consumption when available.
- Settings → Buffer → API measurement shows the latest twenty posts, their status history, per-post counters, and the customer's latest one hundred requests. It makes Convex queries only, with no Buffer polling on open. Counters cover activity after instrumentation activation, not historical usage or unrelated clients.
- The current send path uses one live-channel preflight plus one create-post request. Each explicit status refresh adds one GraphQL request while accepted; terminal posts do not cause another API request. OAuth refresh is conditional and counted separately. Account sync uses one account query plus one channels query per organization and is not assigned to an individual post.
- Scheduled acceptance is not successful publication. Record the provider's `scheduled`, `sent`, or `error` response; verify the terminal state before reporting success. Do not auto-repost uncertain requests.

Quota reference: https://developers.buffer.com/guides/api-limits.html

Official protocol: https://developers.buffer.com/guides/authentication.html
Official post contract: https://developers.buffer.com/reference.html
# Facebook retest diagnostics (2026-10-07)

New post history includes `created` when Mashhad records the immutable request; this is a local event, not a claim that Buffer already created a post. Provider responses record their actual status separately. Creation rejection messages are retained without truncation in the customer's post record. Status queries also request `error { message rawError }` and retain returned publishing errors; known echoed access tokens are redacted. Authenticated customers see only their own diagnostics. Failed or uncertain publication is never automatically resubmitted.

For the Facebook measurement, use an existing vertical video at least 540×960, preferably 720×1280, and schedule it seven minutes ahead. Count preflight, creation and every explicit status query, with OAuth refresh in a separate counter. `Scheduled` is not proof of publication; continue the same post to `Sent` or a terminal error. Reading the measurement panel itself makes no Buffer API call.

