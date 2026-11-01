import test from 'node:test';
import assert from 'node:assert/strict';
import {assertPrivateModelTrialBudget as guard} from '../engine/private-model-trial-policy.mjs';
const NOW=Date.parse('2026-11-01T04:30:00Z'),APPROVED=Date.parse('2026-11-01T04:27:00Z'),ID='12345678-1234-1234-1234-123456789abc';
const bundles={'flux2-klein-4b':['flux','L40S',4,64,300,180],'qwen-image-edit-2511':['qwen','RTX-PRO-6000',4,128,600,300],'wan22-i2v-a14b':['wan','RTX-PRO-6000',8,256,1800,300],'habibi-msa':['speech-habibi-msa','L40S',2,16,600,300]};
function fixture(modelId='wan22-i2v-a14b'){
 const [prefix,gpu,cpu,ramGiB,timeout,startupTimeout]=bundles[modelId],resources={gpu,cpu,ramGiB,timeout,startupTimeout,idleSeconds:60},appName='mashhad-'+prefix+'-'+ID.replaceAll('-','').slice(0,12);
 const s={approved:true,sequentialGpuTestsApproved:true,filmTrialApproved:true,filmId:'afterlife-20261101',filmApprovedAt:APPROVED,account:'basm1998ali',profile:'basm1998ali',env:'main',usageLimitUSD:15,spendLimitUSD:0,trialMaxUSD:15,baselineGrossUSD:0,currentGrossUSD:'0.12',storageGiBUpperBound:450,freeStorageGiB:1024,status:'watching',heartbeatAt:NOW,createdAt:NOW-1000,providerBudgetVerifiedAt:NOW-2000,deadline:NOW+40*60000,globalDeadlineISO:'2026-11-01T08:15:00Z',periodStartISO:'2026-11-01T00:00:00Z',periodEndISO:'2026-12-01T00:00:00Z',engineId:ID,modelId,accountId:'primary',appName};
 const m={filmId:s.filmId,modelId,engineId:ID,accountId:s.accountId,appName,resources};return {s,m,p:{definition:{id:ID,modelId,accountId:s.accountId,...resources},appName,credentials:{expectedWorkspace:'basm1998ali'}}};
}
for(const modelId of Object.keys(bundles))test('new explicit film15 scope accepts exact '+modelId+' bundle independently of expired trials',()=>{const f=fixture(modelId);assert.equal(guard(f.s,f.m,f.p,NOW),true);});
for(const [name,change] of [
 ['absentfilmconsent',f=>{f.s.filmTrialApproved=false;}],['otherfilm',f=>{f.s.filmId='other';}],['othermanifestfilm',f=>{f.m.filmId='other';}],['mixedoldapproval',f=>{f.s.speechContinuationApproved=true;}],['old20budget',f=>{f.s.trialMaxUSD=20;}],['cap16',f=>{f.s.usageLimitUSD=16;}],['discountedbaseline',f=>{f.s.baselineGrossUSD=.12;}],['spent15',f=>{f.s.currentGrossUSD=15;}],['fourhourbypass',f=>{f.s.filmApprovedAt=Date.parse('2026-11-01T04:00:00Z');}],['globaldeadlineextension',f=>{f.s.globalDeadlineISO='2026-11-01T08:30:00Z';}],['perleaseextension',f=>{f.s.deadline=NOW+46*60000;}],['resourcechange',f=>{f.p.definition.idleSeconds=120;}],['nonprimary',f=>{f.p.credentials.expectedWorkspace='other';}]
])test('film scope rejects '+name,()=>{const f=fixture();change(f);assert.throws(()=>guard(f.s,f.m,f.p,NOW),/PRIVATE_TRIAL_/);});
test('film approved models cannot be substituted with Hunyuan or IRQ, nor resumed after global stop',()=>{
 for(const modelId of ['hunyuanvideo15','habibi-irq','habibi-egy']){const f=fixture();f.s.modelId=modelId;assert.throws(()=>guard(f.s,f.m,f.p,NOW),/PRIVATE_TRIAL_/);}
 const f=fixture();assert.throws(()=>guard(f.s,f.m,f.p,Date.parse('2026-11-01T08:15:00Z')),/PRIVATE_TRIAL_/);assert.throws(()=>guard(f.s,f.m,f.p,NOW,{stopRequested:true}),/PRIVATE_TRIAL_STOP_REQUESTED/);
});
