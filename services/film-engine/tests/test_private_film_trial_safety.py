"""Private film budget is separate from the original trials; no cloud calls."""
from datetime import datetime,timezone
import importlib.util
from pathlib import Path
import sys
import unittest
ROOT=Path(__file__).resolve().parents[1]/'engine';sys.path.insert(0,str(ROOT))
from flux.trial_safety import validate_lease
NOW=int(datetime(2026,11,1,4,30,tzinfo=timezone.utc).timestamp()*1000)
APPROVED=int(datetime(2026,11,1,4,27,tzinfo=timezone.utc).timestamp()*1000)
ID='12345678-1234-1234-1234-123456789abc'
PREFIX={'flux2-klein-4b':'flux','qwen-image-edit-2511':'qwen','wan22-i2v-a14b':'wan','habibi-msa':'speech-habibi-msa'}
def lease(model='flux2-klein-4b'):
 return dict(approved=True,sequentialGpuTestsApproved=True,filmTrialApproved=True,filmId='afterlife-20261101',filmApprovedAt=APPROVED,account='basm1998ali',profile='basm1998ali',env='main',modelId=model,engineId=ID,accountId='primary',appName='mashhad-'+PREFIX[model]+'-'+ID.replace('-','')[:12],appId=None,createdAt=NOW,providerBudgetVerifiedAt=NOW,baselineGrossUSD=0,usageLimitUSD=15,spendLimitUSD=0,trialMaxUSD=15,deadline=NOW+40*60000,globalDeadlineISO='2026-11-01T08:15:00Z',periodStartISO='2026-11-01T00:00:00Z',periodEndISO='2026-12-01T00:00:00Z')
class FilmLeaseTests(unittest.TestCase):
 def test_exact_four_models_primary_cap_and_immutable_film_identity(self):
  for model in PREFIX:
   state=lease(model);proof=validate_lease(state,NOW);self.assertEqual(proof['filmId'],'afterlife-20261101');self.assertEqual(proof['filmApprovedAt'],APPROVED)
 def test_missing_mixed_expanded_scope_rejected_before_monitor(self):
  for change in [dict(filmTrialApproved=False),dict(filmId='other'),dict(speechContinuationApproved=True),dict(modelId='hunyuanvideo15'),dict(modelId='habibi-irq'),dict(usageLimitUSD=16),dict(trialMaxUSD=20),dict(baselineGrossUSD=.12),dict(globalDeadlineISO='2026-11-01T08:30:00Z'),dict(filmApprovedAt=APPROVED-3600000),dict(account='other'),dict(deadline=NOW+46*60000)]:
   with self.subTest(change=change),self.assertRaises(ValueError):validate_lease({**lease(),**change},NOW)
 def test_stop_only_supports_exact_film_flux_even_after_financial_lease_expiry(self):
  spec=importlib.util.spec_from_file_location('film_stop_only',ROOT.parents[2]/'scripts/private-model-stop-only.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
  state=lease();manifest={**{k:state[k] for k in ['filmId','modelId','engineId','accountId','appName']},'workspace':'basm1998ali'}
  self.assertEqual(module.validate_stop_scope(state,manifest,NOW+6*3600000)['name'],state['appName'])
  with self.assertRaises(ValueError):module.validate_stop_scope({**state,'filmTrialApproved':False},manifest,NOW)
  with self.assertRaises(ValueError):module.validate_stop_scope(state,{**manifest,'filmId':'other'},NOW)
if __name__=='__main__':unittest.main()
