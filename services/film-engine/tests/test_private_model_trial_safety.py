"""Sequential private trial leases; no cloud operations."""
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'engine'))
from flux.trial_safety import validate_lease, TrialWatchdog
NOW=int(datetime(2026,10,31,22,20,tzinfo=timezone.utc).timestamp()*1000)
ID='12345678-1234-1234-1234-123456789abc'
PREFIX={'qwen-image-edit-2511':'qwen','wan22-i2v-a14b':'wan','hunyuanvideo15':'hunyuan','habibi-irq':'speech-habibi-irq','habibi-egy':'speech-habibi-egy','habibi-msa':'speech-habibi-msa'}
def lease(model='qwen-image-edit-2511'):
    return dict(account='basm1998ali',profile='basm1998ali',env='main',appName='mashhad-'+PREFIX[model]+'-'+ID.replace('-','')[:12],appId=None,createdAt=NOW,baselineGrossUSD=6.34874585,usageLimitUSD=21,spendLimitUSD=0,trialMaxUSD=20,providerBudgetVerifiedAt=NOW,periodStartISO='2026-10-01T00:00:00Z',periodEndISO='2026-11-01T00:00:00Z',deadline=NOW+30*60000,approved=True,sequentialGpuTestsApproved=True,modelId=model,engineId=ID,accountId='private-primary',globalDeadlineISO='2026-10-31T23:30:00Z')
class Provider:
    def __init__(self,state):self.state=state;self.stops=[]
    async def observe(self,state):return dict(workspace='basm1998ali',env='main',grossUSD='8',apps=[dict(id='ap-own',name=self.state['appName'],env='main',createdAt=NOW+1000,state='active')])
    async def stop(self,*args):self.stops.append(args)
    async def confirm_stopped(self,*args):return True
class SequentialTests(unittest.IsolatedAsyncioTestCase):
    def test_new_cycle_speech_carries_previous_full_cap_and_requires_exact_approval(self):
        now=int(datetime(2026,11,1,0,45,tzinfo=timezone.utc).timestamp()*1000)
        for model in ('habibi-irq','habibi-egy','habibi-msa'):
            state={**lease(model),'speechContinuationApproved':True,'previousPeriodExposureUSD':14.65125415,'usageLimitUSD':5,'baselineGrossUSD':0,'createdAt':now,'providerBudgetVerifiedAt':now,'deadline':now+30*60000,'globalDeadlineISO':'2026-11-01T02:00:00Z','periodStartISO':'2026-11-01T00:00:00Z','periodEndISO':'2026-12-01T00:00:00Z'}
            self.assertEqual(validate_lease(state,now)['modelId'],model)
            for change in ({'speechContinuationApproved':False},{'usageLimitUSD':6},{'previousPeriodExposureUSD':0},{'modelId':'wan22-i2v-a14b'},{'spendLimitUSD':1},{'globalDeadlineISO':'2026-11-02T02:00:00Z'}):
                with self.subTest(change=change),self.assertRaises(ValueError):validate_lease({**state,**change},now)

    def test_exact_model_account_and_approved_cap_before_fixed_stop(self):
        for model in PREFIX:
            state=lease(model);self.assertEqual(validate_lease(state,NOW)['modelId'],model)
        for change in [dict(sequentialGpuTestsApproved=False),dict(modelId='flux2-klein-4b'),dict(engineId='other'),dict(appName='mashhad-wan-ffffffffffff'),dict(usageLimitUSD=26),dict(spendLimitUSD=1),dict(baselineGrossUSD=0),dict(globalDeadlineISO='2026-11-01T23:30:00Z'),dict(deadline=NOW+71*60000)]:
            with self.subTest(change=change),self.assertRaises(ValueError):validate_lease({**lease(),**change},NOW)
    async def test_provider_cap_reached_stops_exact_model_app(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'state.json';state=lease();path.write_text(json.dumps(state));provider=Provider(state)
            original=provider.observe
            async def capped(value):
                result=await original(value);result['grossUSD']='21';return result
            provider.observe=capped
            result=await TrialWatchdog(path,provider,now=lambda:NOW).step()
            self.assertEqual(result['stopReason'],'TRIAL_COST_GUARD_REACHED');self.assertTrue(result['cloudStopped']);self.assertEqual(provider.stops[0][0],'ap-own')
    async def test_model_identity_mutation_stops_only_bound_app(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'state.json';state=lease();path.write_text(json.dumps(state));provider=Provider(state);watch=TrialWatchdog(path,provider,now=lambda:NOW)
            self.assertEqual((await watch.step())['status'],'watching')
            changed=json.loads(path.read_text());changed['modelId']='wan22-i2v-a14b';path.write_text(json.dumps(changed))
            result=await watch.step();self.assertTrue(result['cloudStopped']);self.assertEqual(result['stopReason'],'TRIAL_LEASE_CHANGED');self.assertEqual(provider.stops,[('ap-own',state['appName'],'main')])
if __name__=='__main__':unittest.main()
