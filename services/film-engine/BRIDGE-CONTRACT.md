# Film bridge operation contract v1

`POST /api/film-bridge` is server-to-server only. native action `filmBridge.request({operation,input,requestId})` derives the actor from authenticated server identity and the server administrator email allowlist. The browser must never supply actor/admin status, signature, provider IDs or bridge key. The action returns the gateway JSON unchanged for success, or safe `{error,message}` on failure. Backend customer IDs are hashed opaque IDs; admin topups use IDs from `admin.customers.list`, not raw native actor IDs.

Body must be exact JSON bytes `{requestId,actor:{id,email,name,isAdmin},operation,input}`. Sign lowercase hex HMAC-SHA256 of `timestamp + "\n" + nonce + "\n" + rawBody`. Headers: `x-film-time` (13 digit Unix milliseconds), `x-film-nonce` (20–80 alphanumeric/dash), `x-film-signature` (64 hex). Clock window 60 seconds, nonce persisted for 120 seconds. Every HTTP attempt needs a fresh nonce; reuse requestId and identical body only to recover an existing mutation result. Financial/mutation request outcomes are durable; read-only polling has no persistent response cache. A timeout/`REQUEST_STATE_UNKNOWN` is not permission to repeat a paid operation with a new ID.

TLS required; only a loopback reverse proxy may assert `x-forwarded-proto:https`. Body maximum 256 KiB. No browser CORS access to bridge. Media has separately configured exact origins. All money is integer micro-USD except explicitly named decimal USD fields. Timestamps are Unix milliseconds. Customer payloads are allowlisted; redaction depends on operation prefix even if the actor is an administrator.

| Customer operation | Input | Result |
|---|---|---|
| session | `{}` | `{user:{id,name},wallet,servers,enabled,planningEnabled,capabilities}` |
| wallet | `{}` | `{balanceMicroUSD,expiresAt,reservedMicroUSD:0,activeRentalId,lots:[{amountMicroUSD,remainingMicroUSD,expiresAt,expired}]}` |
| servers.list | `{}` | `[{id,name,gpu,ram,cpu,pricePerHourUSD,state,availability}]`; state locked/busy/available |
| rental.quote | `{serverId}` | `{serverId,revision,priceMicroUSD,pricePerHourUSD,minimumCreditUSD,warning,canStart}` |
| rental.start | `{serverId,revision,priceMicroUSD,approved:true,requestId}` | rental DTO; input requestId is a stable per-customer rental intent |
| rental.status / rental.stop | `{id:rentalId}` | rental DTO; stop only requests stop, closed means verified zero resources |
| projects.list | `{}` | project DTO array |
| project.save | `{id?,name,story,seconds,orientation}` | project DTO; seconds 10–300, multiple of 10; portrait/landscape |
| project.get / project.follow | `{id:projectId}` | project DTO, reconcile existing committed scene jobs only; no paid retry |
| chat.submit | `{projectId,message,approved:true}` | `{accepted:true,textCostPolicy}`; separately approve administrator-funded text |
| review.submit | `{projectId,approved:true}` | One durable visual-review intent per project, six server-extracted frames per verified owned scene, separate administrator-funded approval. Follow via project.get; never regenerates or replaces media. |
| plan.submit | `{projectId,approved:true}` | same; sequential batches of at most six scenes, maximum 30 scenes |
| text.status / plan.status | `{projectId}` | project DTO |
| project.generate | `{projectId,rentalId,approved:true,directorFollow?:boolean}` | `{accepted:true}`; approves the persisted plan under a ready rental |
| project.resume | `{projectId,rentalId,approved:true,directorFollow?:boolean}` | `{accepted:true}`; only unattempted remaining scenes; all old attempts verified done and previous rental verified stopped; new ready rental required |
| project.merge | `{projectId}` | project DTO with persisted merge status; local CPU stream-copy, no new scenes/GPU |
| media.ticket | `{projectId,index:number|"merged"}` | `{url,expires}`; opaque signed ticket, 180 seconds, owner only |

Rental DTO: `id,serverId,state,elapsedSeconds,billedMicroUSD,hourPriceUSD,lowFunds,phase,completed,total,stopReason,message`. State: reserved/preparing/ready/stopping/uncertain/closed. Progress counters and phase are persisted engine events; null means unknown; no synthetic percentage or ETA. `reservedMicroUSD:0` means the sole active rental has exclusive access to this film wallet, not a separate frozen hold.

Project DTO: `id,name,merge:{status,error,duration,width,height,nativeAudio}|null,story,messages:[{role,content}],seconds,orientation,state,textPending,textUncertain,textCostPolicy,planningCompletedScenes,scenes:[{index,title,status,dialogue:[{speaker,text}],phase,completed,total,ready}],error`. Project state draft/planned/generating/needs_review/completed. Scene status pending/submitted/done/needs_review. A scene job/provider ID never appears. `ready` means verified original video including native audio; no cleanup/voice substitution. Whole-film concatenation runs after all scenes are verified or with project.merge; merge status running/completed/unavailable/failed is independent of scene generation success. Local CPU stream-copy preserves original video and native audio. FFprobe verifies duration, dimensions and AV streams; if ffprobe is absent, a real FFmpeg full decode validates AV metadata, explicitly labeled checker ffmpeg_full_decode internally. Missing tools produce merge unavailable; ordered clips remain intact. Merged artifact uses media.ticket index:"merged". Text policy is `administrator_funded_separate_from_gpu_wallet`; it never touches existing native tool-wallet balances.

| Admin operation | Input / behavior |
|---|---|
| admin.customers.list | `{}` returns customers with film wallets |
| admin.credit.add | `{customerId,amountUSD,requestId}` immutable topup, exact decimal string up to six places; expires after 30 days; same id with changed customer/amount conflicts |
| admin.accounts.list | `{}` account identity/readiness, slot list, active count, manual billing and declared capacity; no token secrets |
| admin.account.link | `{name,tokenId,tokenSecret}` readonly verify/dedup and encrypted save; no GPU or weights copy |
| admin.account.inspect | `{accountId}` readonly discovery; uses existing engine discover route |
| admin.account.activate | `{accountId}` verifies files before activation |
| admin.account.unlink | `{accountId,approved:true}` nonprimary only, all slots retired and all recorded source/destination resources confirmed stopped. Atomic credential removal archives only safe account metadata; preserves every historical row/media and all provider files. Does not revoke the provider token remotely. |
| admin.account.lock | `{accountId,locked:boolean}` group lock; does not stop active rentals |
| admin.account.stop | `{accountId,approved:true}` explicit group emergency stop; no resource release until verified |
| admin.test.quote | `{id:slotId,prompt,audioContract}` explicit future GPU-quality sample quote only; cold native-AV generation, no execution |
| admin.test.execute | `{quoteId,approved:true}` exact persisted admin sample quote only; revision rechecked; no tenant quote accepted |
| admin.prepare.quote | `{accountId}` CPU preparation quote; no execution |
| admin.prepare.execute | `{quoteId,approved:true}` exact prepare quote only, explicit cost approval |
| admin.operation.status | `{id:jobIdOrStopGroupId}` persisted administrator operation status; unresolved stop groups receive read-only reconciliation |
| admin.slot.save | `{id?,accountId,name,hourPriceUSD,gpu?}` max two per account; second requires name+price only (same account selected), inherits GPU, same vault/volume/weights; RTX-PRO-6000 default; L40S explicit alternate; draft+locked initially |
| admin.slot.retire | `{id,approved:true}` permanently lock/unpublish after all account rentals and source/destination jobs are confirmed stopped. No implicit stop or cloud deletion; preserve row, rate and history. Retired rows never return to catalog/admission/publication or editing. Only nonretired rows count toward max two, and only active configuration may be inherited. |
| admin.slot.verify | `{id:slotId,jobId,reviewed:true}` actual same-account/GPU/quality completed verified video plus explicit visual/audio review |
| admin.slot.publish | `{id}` rechecks proof, quality, activation/readiness; no fake/local fixture proof in production |
| admin.slot.lock | `{id,locked:boolean}` blocks only new rentals |
| admin.slot.stop | `{id,approved:true}` explicit emergency stop |
| admin.capacity.save | `{accountId,maxConcurrent:1|2}` declared concurrency only, never verified quota/capacity |
| admin.billing.save | `{accountId,remainingUSD:string|null,expiresAt:number|null,renewsAt:number|null}` manual metadata; zero accepted; source always administrator |
| admin.billing.list | `{}` manual metadata, never inferred $30 credits or generic failure as exhaustion |
| admin.rentals.list | `{}` customer charges, uncovered supplier liability, provider recorded cost vs unknown estimate, account/customer IDs for admin only |
| admin.alerts.list / admin.alert.ack | `{}` / `{id}`; real stop/failure/uncertainty and explicitly manual expiry warnings |
| admin.text.config | `{}` configured boolean/pricing metadata, never key |
| admin.text.key.save | `{key}` explicit encrypted key provisioning; readonly model-access check, no text generation |
| admin.text.key.remove | `{}` encrypted key unlink |

All `admin.*` require derived `isAdmin:true`. Text must additionally be enabled with positive administrator budget; conservative reservation is $0.10 per call, up to five calls per 300-second plan, 30 calls/project and 30/customer/day. Global 30-day reservations never exceed configured micro-USD budget. Reservation is a conservative limit, not a provider invoice or a GPU-wallet charge. Engine request IDs, project pending state and uncertain results persist; restart never repeats an LLM call.

Cross-rental resume uses only the server-owned last-frame.png of the previous verified same-owner/project scene. It accepts no client file path/job ID/image input. It does not promise latent, voice or continuous-audio identity. Ambiguous/failed attempted scenes block resume. Successful scenes and media remain accessible independently of current supplier account. `project.follow` never starts a new scene. No automatic retry after a fault; owning rental receives a stop request.

Session referenceUpload requires configured allowed media origins and the signed reference extension below. ingredients:false and voiceCloning:false remain explicit. Real last-frame continuity is distinct from first-frame reference conditioning. No image generation/model download is enabled.

Pause/stop semantics: there is no background-free pause that keeps the GPU unbilled. rental.stop requests actual resource shutdown; progress/status remain durable and the browser must poll rental.status until closed (uncertain retains the lease). Stopping during a submitted scene can make that attempt ambiguous and therefore blocks paid resume. project.follow only discovers/refreshes existing committed jobs, including after restart. project.resume requires separate explicit approval under a newly ready rental, previous verified stop, and a contiguous prefix of verified successful scenes; only untouched remaining scenes may start. Browser close never pauses or stops billing. Gateway shutdown drain is bounded; if a provider does not stop within it, durable uncertain state remains and next startup stops/reconciles instead of reallocating.

## Reference extension (local implementation)

- `project.reference.ticket {projectId}` returns `{url,expires,maxBytes}`. Direct PUT raw JPEG/PNG bytes, no JSON/base64 and no browser credentials. One use, two minutes, exact-origin CORS; maximum4,000,000 bytes and4096/16MP bounds. A new ticket is needed after a rejected upload. An interrupted/ambiguous upload must be followed with project.get, not silently repeated.
- `project.reference.view {projectId}` returns a separate private `{url,expires}` for GET; only the current project reference is served. No filesystem paths/provider keys are exposed.
- `project.reference.remove {projectId}` unlinks the current reference from an unattempted project; old private source file is retained. Returns project DTO.
- Project reference DTO contains only mime,size,width,height,uploadedAt. Session referenceUpload is true only with configured allowed media origins. Ingredients/voiceCloning remain false.
- Upload is rejected during text/generation, after any scene attempt, or on stale/concurrent tickets. Old valid data survives failed replacement. Saved image conditions the first scene only; next scene uses verified last-frame continuity.

Reference upload storage is bounded by a trusted per-customer retained-byte quota (default64MiB). A4,000,000-byte durable reservation is claimed before reading upload bytes. REFERENCE_QUOTA is a safe user error; no file is removed to make room. Normal failed uploads release reservations after cleanup; crashes/failed cleanup retain them until explicit offline reconciliation. Successful replacements and unlinks keep counting original files.

### Emergency-stop result and follow-up

Account stop includes the account's recorded standalone administrator sample and CPU preparation jobs, in addition to rentals. Slot stop includes its rentals and standalone samples bound by the saved test quote to the same slot/account; it never selects another slot's sample. Cancellation is deduplicated by the parent session when completed clips share it. A failed/completed local status does not prove resources stopped. Unconfirmed standalone work blocks new rental dispatch and account unlink/credential replacement.

Both stop operations return `{id,requested:true,confirmed,pending,jobs:[{id,status,cloudStopped}],rentals:[{id,state}],createdAt,finishedAt,message}`. The ID names a durable stop group. Follow it using existing `admin.operation.status({id})`; this only inspects/reconciles the previously selected resources, never starts or regenerates. The administrator UI polls an unresolved group every four seconds and only shows confirmed closure when all recorded members confirm. Empty groups explicitly say that this is not a provider-wide resource inventory. `activeCount` includes open rentals plus standalone root operations with unconfirmed resources; `standaloneActiveCount` is the latter, not a physical GPU/container count.

### Private MP4 transport

Current owner-bound media tickets authorize GET/HEAD only for their verified scene or unchanged merged artifact. Exact-origin restrictions and ticket expiry apply to every request, including ranges. The route supports one byte range (`206`, `Content-Range`, `Accept-Ranges: bytes`), suffix/open ranges, and `416` for invalid/multiple/unsatisfiable ranges. It never serves an unauthorized full file in response to a bad range. Tickets remain short-lived; after expiry the player asks for a fresh free viewing link and retains its playback position. Renewing a link never generates video or starts a rental.


## Optional sequential director follow

`directorFollow:true` in the generation approval reserves administrator text budget ($0.25 per unattempted scene, not an invoice cap). After each verified clip a single review call examines six frames and proposes only the next visual prompt. The original plan and native Arabic audio contract are retained. Text detected/uncertain, causal or continuity concerns, invalid continuation, timeout or ambiguous response halt the sequence and request rental stop; never regenerate a successful clip or retry the call. Stored review IDs survive reload; interrupted follow requires manual review, not automatic resubmission. GPU rental time while waiting for OpenAI remains billable. Omit/false preserves the existing generation-only flow. Review reports do not assess audio or guarantee full-video quality.
