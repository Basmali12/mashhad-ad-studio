import test from 'node:test';
import assert from 'node:assert/strict';
import {assertPrivateModelTrialBudget as guard} from '../engine/private-model-trial-policy.mjs';
const NOW=Date.parse('2026-10-31T22:20:00Z'),ID='12345678-1234-1234-1234-123456789abc';
const prefixes={'qwen-image-edit-2511':'qwen','wan22-i2v-a14b':'wan','hunyuanvideo15':'hunyuan','habibi-irq':'speech-habibi-irq','habibi-egy':'speech-habibi-egy','habibi-msa':'speech-habibi-msa'};
function fixture(modelId='qwen-image-edit-2511'){
 const appName='mashhad-'+prefixes[modelId]+'-'+ID.replaceAll('-','').slice(0,12),speech=modelId.startsWith('habibi-'),resources={gpu:speech?'L40S':'RTX-PRO-6000',cpu:speech?2:8,ramGiB:speech?16:128,timeout:600,startupTimeout:300,idleSeconds:2};
 const s={approved:true,sequentialGpuTestsApproved:true,account:'basm1998ali',profile:'basm1998ali',env:'main',usageLimitUSD:21,spendLimitUSD:0,trialMaxUSD:20,baselineGrossUSD:6.34874585,currentGrossUSD:'8.0',storageGiBUpperBound:450,freeStorageGiB:1024,status:'watching',cloudStopped:false,heartbeatAt:NOW,createdAt:NOW-1000,deadline:NOW+30*60000,globalDeadlineISO:'2026-10-31T23:30:00Z',periodStartISO:'2026-10-01T00:00:00Z',periodEndISO:'2026-11-01T00:00:00Z',providerBudgetVerifiedAt:NOW-2000,modelId,engineId:ID,accountId:'private-primary',appName};
 const m={modelId,engineId:ID,accountId:s.accountId,appName,resources};const p={definition:{id:ID,accountId:s.accountId,modelId,...resources},appName,credentials:{expectedWorkspace:'basm1998ali'}};return {s,m,p};
}
for(const model of Object.keys(prefixes))test('explicit private sequential scope admits '+model+' only on approved account/resources',()=>{const {s,m,p}=fixture(model);assert.equal(guard(s,m,p,NOW),true);});
for(const [name,change] of [
 ['missing approval',f=>{f.s.sequentialGpuTestsApproved=false;}],['changed baseline',f=>{f.s.baselineGrossUSD=6;}],['raised cap',f=>{f.s.usageLimitUSD=26;}],['payment enabled',f=>{f.s.spendLimitUSD=1;}],['other account',f=>{f.p.credentials.expectedWorkspace='other';}],['other model',f=>{f.p.definition.modelId='flux2-klein-4b';}],['other engine',f=>{f.p.definition.id='different';}],['other app',f=>{f.p.appName='another';}],['changed resource',f=>{f.p.definition.ramGiB=256;}],['stale heartbeat',f=>{f.s.heartbeatAt=NOW-20001;}],['future heartbeat',f=>{f.s.heartbeatAt=NOW+1001;}],['provider cap reached',f=>{f.s.currentGrossUSD=21;}],['billing rollover',f=>{f.s.currentGrossUSD=0;}],['global deadline bypass',f=>{f.s.deadline=Date.parse('2026-10-31T23:31:00Z');}],['unknown stop',f=>{f.s.stopReason='TRIAL_PROVIDER_STATE_UNKNOWN';}],['expired proof',f=>{f.s.providerBudgetVerifiedAt=f.s.createdAt-300001;}]
])test('sequential policy rejects '+name,()=>{const f=fixture();change(f);assert.throws(()=>guard(f.s,f.m,f.p,NOW),/PRIVATE_TRIAL_/);});
test('armed state only permits preparation and stop control prevents further calls',()=>{const f=fixture();f.s.status='armed';assert.throws(()=>guard(f.s,f.m,f.p,NOW),/PRIVATE_TRIAL_/);f.p.trialAction='prepare';assert.equal(guard(f.s,f.m,f.p,NOW),true);assert.throws(()=>guard(f.s,f.m,f.p,NOW,{stopRequested:true}),/PRIVATE_TRIAL_STOP_REQUESTED/);});
test('all stages share original round baseline and finite UTC stop across local midnight',()=>{const f=fixture();assert.equal(guard(f.s,f.m,f.p,NOW),true);assert.ok(f.s.usageLimitUSD-f.s.baselineGrossUSD<20);assert.throws(()=>guard(f.s,f.m,f.p,Date.parse('2026-10-31T23:30:00Z')),/PRIVATE_TRIAL_/);});

test('new-cycle speech approval carries previous maximum exposure and rejects scope/cap/reset mutations',()=>{
 const now=Date.parse('2026-11-01T00:45:00Z');
 for(const model of ['habibi-irq','habibi-egy','habibi-msa']){
  const f=fixture(model);Object.assign(f.s,{speechContinuationApproved:true,previousPeriodExposureUSD:14.65125415,usageLimitUSD:5,baselineGrossUSD:0,currentGrossUSD:'0',heartbeatAt:now,createdAt:now-1000,deadline:now+30*60000,providerBudgetVerifiedAt:now-2000,globalDeadlineISO:'2026-11-01T02:00:00Z',periodStartISO:'2026-11-01T00:00:00Z',periodEndISO:'2026-12-01T00:00:00Z'});
  assert.equal(guard(f.s,f.m,f.p,now),true);
  assert.ok(f.s.previousPeriodExposureUSD+f.s.usageLimitUSD<20);
  for(const mutation of [{speechContinuationApproved:false},{usageLimitUSD:6},{previousPeriodExposureUSD:0},{modelId:'wan22-i2v-a14b'},{spendLimitUSD:1},{globalDeadlineISO:'2026-11-02T02:00:00Z'},{currentGrossUSD:'5'},{periodEndISO:'2027-01-01T00:00:00Z'}])assert.throws(()=>guard({...f.s,...mutation},f.m,f.p,now),/PRIVATE_TRIAL_/);
 }
});
