import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {verifyArtifactStorage} from '../engine/artifact-storage.mjs';
async function fixture(t){const root=await mkdtemp(path.join(tmpdir(),'film-artifact-write-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
test('checks real durable writes and removes its probe without touching video files',async t=>{
 const root=await fixture(t);await verifyArtifactStorage(root,'job-one');
 const video=path.join(root,'artifacts/job-one/video.mp4');await writeFile(video,'preserve-existing');
 await verifyArtifactStorage(root,'job-one');assert.deepEqual(await readdir(path.dirname(video)),['video.mp4']);
});
test('a non-directory output path blocks the operation with an opaque local error',async t=>{
 const root=await fixture(t);await writeFile(path.join(root,'artifacts'),'blocked');
 await assert.rejects(verifyArtifactStorage(root),/^Error: LOCAL_ARTIFACT_NOT_WRITABLE$/);
});
