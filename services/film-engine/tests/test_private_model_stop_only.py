import asyncio
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('stop_only', ROOT/'scripts/private-model-stop-only.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
NOW = 1000000
ENGINE = '00000000-1111-2222-3333-444444444444'
NAME = 'mashhad-wan-' + ENGINE.replace('-', '')[:12]
def fixture():
    s = {'approved': True, 'sequentialGpuTestsApproved': True, 'modelId': 'wan22-i2v-a14b', 'engineId': ENGINE, 'accountId': 'primary', 'account': 'basm1998ali', 'profile': 'basm1998ali', 'env': 'main', 'appName': NAME, 'createdAt': NOW}
    return s, {**{k:s[k] for k in ['modelId','engineId','accountId','appName']}, 'workspace': 'basm1998ali'}
class Provider:
    def __init__(self, apps): self.apps=apps; self.stops=[]; self.confirm=True; self.reads=0
    async def observe(self,state): self.reads+=1; return {'workspace':'basm1998ali','env':'main','apps':self.apps}
    async def stop(self,*scope): self.stops.append(scope)
    async def confirm_stopped(self,*scope): return self.confirm
class StopOnlyTests(unittest.IsolatedAsyncioTestCase):
    async def test_exact_fresh_app_stopped_without_touching_foreign(self):
        s,m=fixture(); p=Provider([{'id':'ap-owned','name':NAME,'env':'main','createdAt':NOW}, {'id':'ap-foreign','name':'unrelated','env':'main','createdAt':NOW}])
        r=await module.stop_private_scope(s,m,p,now=NOW,deployment_settled=True)
        self.assertTrue(r['cloudStopped']); self.assertTrue(r['taskListZeroConfirmed']); self.assertEqual(p.stops,[('ap-owned',NAME,'main')])
    async def test_bound_app_checks_age_and_exact_scope(self):
        s,m=fixture(); s['boundAppId']='ap-owned'
        for app in [{'id':'ap-owned','name':NAME,'env':'main','createdAt':NOW-5001},{'id':'ap-owned','name':'foreign','env':'main','createdAt':NOW}]:
            p=Provider([app])
            with self.assertRaises(ValueError): await module.stop_private_scope(s,m,p,now=NOW,deployment_settled=True)
            self.assertEqual(p.stops,[])
    async def test_no_absence_claim_while_deployment_unsettled(self):
        s,m=fixture();p=Provider([]);r=await module.stop_private_scope(s,m,p,now=NOW,attempts=2,interval=0)
        self.assertFalse(r['cloudStopped']);self.assertEqual(p.reads,2);self.assertEqual(p.stops,[])
    async def test_even_confirmed_app_stop_does_not_claim_settled_deployment(self):
        s,m=fixture();p=Provider([{'id':'ap-owned','name':NAME,'env':'main','createdAt':NOW}]);r=await module.stop_private_scope(s,m,p,now=NOW)
        self.assertTrue(r['appStopConfirmed']);self.assertFalse(r['cloudStopped'])
    async def test_settled_no_app_is_explicit_absence_not_false_task_receipt(self):
        s,m=fixture();p=Provider([]);r=await module.stop_private_scope(s,m,p,now=NOW,deployment_settled=True)
        self.assertTrue(r['cloudStopped']);self.assertTrue(r['appAbsentAfterSettledDeployment']);self.assertNotIn('taskListZeroConfirmed',r)
    async def test_ambiguous_fresh_apps_and_changed_manifest_never_stop(self):
        s,m=fixture();p=Provider([{'id':i,'name':NAME,'env':'main','createdAt':NOW} for i in ['ap-one','ap-two']])
        with self.assertRaises(ValueError):await module.stop_private_scope(s,m,p,now=NOW)
        self.assertEqual(p.stops,[])
        with self.assertRaises(ValueError):await module.stop_private_scope(s,{**m,'engineId':'different'},p,now=NOW)
    async def test_stop_requires_both_app_stopped_and_zero_tasks(self):
        s,m=fixture();p=Provider([{'id':'ap-owned','name':NAME,'env':'main','createdAt':NOW}]);p.confirm=False
        r=await module.stop_private_scope(s,m,p,now=NOW,deployment_settled=True,attempts=2,interval=0)
        self.assertFalse(r['cloudStopped']);self.assertFalse(r['taskListZeroConfirmed'])
    async def test_late_exact_app_is_stopped_after_initial_absence(self):
        s,m=fixture();p=Provider([])
        async def wait(_):p.apps=[{'id':'ap-late','name':NAME,'env':'main','createdAt':NOW+1}]
        r=await module.stop_private_scope(s,m,p,now=NOW,attempts=2,wait=wait)
        self.assertEqual(p.stops,[('ap-late',NAME,'main')]);self.assertFalse(r['cloudStopped'])
class AppListOnlyTests(unittest.IsolatedAsyncioTestCase):
    async def test_emergency_observation_never_calls_billing_even_if_billing_is_down(self):
        s,_=fixture();calls=[]
        class Stub:
            async def AppList(self,request):
                calls.append(('AppList',request.environment_name))
                return SimpleNamespace(apps=[SimpleNamespace(app_id='ap-owned',name=NAME,description='',created_at=NOW/1000,state=1),SimpleNamespace(app_id='ap-old-foreign',name='foreign',description='',created_at=1,state=2)])
            async def WorkspaceBillingSummary(self,*args):
                raise AssertionError('Emergency stop may not depend on billing')
        class Observer(module.StopOnlyAppObserver):
            workspace='basm1998ali'
            async def connection(self):return SimpleNamespace(_stub=Stub())
        api=SimpleNamespace(APP_STATE_STOPPED=2,AppListRequest=lambda **kwargs:SimpleNamespace(**kwargs))
        with patch.dict('sys.modules',{'modal_proto':SimpleNamespace(api_pb2=api)}):
            result=await Observer().observe(s)
        self.assertEqual(calls,[('AppList','main')])
        self.assertEqual(result['apps'],[{'id':'ap-owned','name':NAME,'env':'main','createdAt':NOW,'state':'active'}])
        self.assertEqual(result['workspace'],'basm1998ali')
    async def test_stopped_owned_app_remains_visible_for_getinfo_tasklist_confirmation(self):
        s,_=fixture()
        class Stub:
            async def AppList(self,request):return SimpleNamespace(apps=[SimpleNamespace(app_id='ap-owned',name='',description=NAME,created_at=NOW/1000,state=2)])
        class Observer(module.StopOnlyAppObserver):
            workspace='basm1998ali'
            async def connection(self):return SimpleNamespace(_stub=Stub())
        api=SimpleNamespace(APP_STATE_STOPPED=2,AppListRequest=lambda **kwargs:SimpleNamespace(**kwargs))
        with patch.dict('sys.modules',{'modal_proto':SimpleNamespace(api_pb2=api)}):result=await Observer().observe(s)
        self.assertEqual(result['apps'][0]['state'],'stopped');self.assertEqual(result['apps'][0]['id'],'ap-owned')

if __name__=='__main__':unittest.main()
