# Private narration tail repair — 2026-11-01

User reported annoying ending sound in the 15-second trial. Signal analysis finds stationary harmonic activity from 12.80 seconds, already present in raw pre-watermark output. Quiet gap: 12.14–12.80 seconds. Reviewed derived PCM mutes from 12.470 seconds with a 10ms fade inside this gap; earlier samples through 12.460 seconds are identical. Original media remain unchanged.

`engine/narration-tail.mjs` is signal-only QA, not speech recognition. It never automatically removes a candidate. `three-arab-film-track.mjs` rejects suspect private trial admission until a hash-bound reviewed repair is supplied. This changes no customer chat UI or approval flow. Do not blindly enable native latent flatten trimming: an interior pause could be mistaken for an endpoint.

`scripts/repair-three-arab-video-tail.mjs` produced reviewed-film.mp4 with existing production mixing and final artifact/thumbnail registration. All 240 decoded video frames are identical; video stream copied, duration 15 seconds, 720x1280 at 16fps. First 12 seconds decoded audio correlation 1.0; ending RMS dropped from -36.885dB to digital silence. Earlier speech was not regenerated, sped up or pitch shifted. Full FFmpeg decode passed. No GPU/API/spend/deployment.

Visual review used 30 frames covering the full film. Same dark shirt and room persist, no obvious generated captions in the inspected frames. Motion is subtle; phone action and turn toward doorway are weak/not clearly realized. These generation limitations were not repaired or claimed solved. No auditory pronunciation or ASR word-completeness proof. Watermark detector was not re-run after tail modification; surviving speech PCM is unchanged but detector efficacy is unverified.

Focused Node tests: 7 pass, 0 fail. Root lint excludes engine MJS; direct Node tests and actual FFmpeg execution provide evidence for this scope. See adjacent JSON and work/three-arab-video-trial1/review1/repair-result.json for measured artifact hashes and validation.

Fresh phase checks: TypeScript and customer production build passed; root lint passed; 746 React tests across 172 files passed; reels/streaming service bundles built without starting a service. Combined focused plus React count: 753 passed, zero failed. No production publication.
