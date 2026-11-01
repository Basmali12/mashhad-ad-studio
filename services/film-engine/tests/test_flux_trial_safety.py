"""No cloud calls: real lease controller and actual SDK protobuf regressions."""
import copy
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

ROOT=Path(__file__).resolve().parents[1]/'engine'
sys.path.insert(0,str(ROOT))
from flux.trial_safety import TrialWatchdog, validate_lease, timestamp

NOW=int(datetime(2026,10,31,19,0,tzinfo=timezone.utc).timestamp()*1000)


def lease():
    return {'account':'basm1998ali','profile':'basm1998ali','env':'main','appName':'mashhad-flux-abcdef123456','appId':None,'createdAt':NOW,'baselineGrossUSD':6.34874585,'usageLimitUSD':26,'spendLimitUSD':0,'trialMaxUSD':20,'providerBudgetVerifiedAt':NOW,'periodStartISO':'2026-10-01T00:00:00Z','periodEndISO':'2026-11-01T00:00:00Z','deadline':NOW+40*60000,'approved':True}


class Provider:
    def __init__(self):
        self.apps=[];self.gross='6.34874585';self.stops=[];self.confirm=True;self.error=False

    async def observe(self,state):
        if self.error:raise RuntimeError('secret HTTP response never retained')
        return {'workspace':'basm1998ali','env':'main','apps':copy.deepcopy(self.apps),'grossUSD':self.gross}

    async def stop(self,id,name,env):self.stops.append((id,name,env))
    async def confirm_stopped(self,*args):return self.confirm


class TrialTests(unittest.IsolatedAsyncioTestCase):
    async def test_gpu_validation_requires_explicit_flag_and_stopped_older_same_name_does_not_bind(self):
        later=NOW+160*60000
        state={**lease(),'createdAt':later,'providerBudgetVerifiedAt':later,'deadline':later+8*60000,'usageLimitUSD':7,'twoPeriodCapApproved':True,'gpuValidationApproved':True}
        validate_lease(state,later)
        with self.assertRaises(ValueError):validate_lease({**state,'gpuValidationApproved':False},later)
        self.path.write_text(json.dumps(state));watch=TrialWatchdog(self.path,self.provider,now=lambda:later)
        old=self.own(state='stopped');self.provider.apps=[old]
        self.assertEqual((await watch.step())['status'],'armed');self.assertFalse(self.provider.stops)
        fresh=self.own(id='ap-fresh',createdAt=later+1000);self.provider.apps=[old,fresh]
        out=await watch.step();self.assertEqual(out['status'],'watching');self.assertEqual(out['appId'],'ap-fresh')

    async def test_one_transient_metadata_read_is_retried_without_stopping_or_allocating(self):
        original=self.provider.observe;reads=[]
        async def flaky(state):
            reads.append(1)
            if len(reads)==1:
                from modal.exception import ConnectionError as ModalConnectionError
                raise ModalConnectionError('private provider request')
            return await original(state)
        self.provider.observe=flaky
        with patch.object(self.watch,'sleep',new=AsyncMock()):out=await self.watch.step()
        self.assertEqual(out['status'],'armed');self.assertEqual(len(reads),2);self.assertFalse(self.provider.stops)

    async def test_explicit_lower_weight_cap_keeps_two_periods_under_budget_without_using_local_midnight_as_provider_reset(self):
        now=NOW+110*60000
        state={**lease(),'appName':'mashhad-weights-abcdef123456','createdAt':now,'providerBudgetVerifiedAt':now,'deadline':now+40*60000,'usageLimitUSD':7,'twoPeriodCapApproved':True}
        validate_lease(state,now)
        self.assertLess(2*state['usageLimitUSD']-state['baselineGrossUSD'],20)
        for change in ({'twoPeriodCapApproved':False},{'appName':'mashhad-flux-abcdef123456'},{'usageLimitUSD':26}):
            with self.assertRaises(ValueError):validate_lease({**state,**change},now)

    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.path=Path(self.tmp.name)/'state.json';self.path.write_text(json.dumps(lease()));self.provider=Provider();self.now=NOW;self.watch=TrialWatchdog(self.path,self.provider,now=lambda:self.now)

    def own(self,**kwargs):
        return {'id':'ap-owned','name':lease()['appName'],'env':'main','createdAt':NOW+1000,'state':'active',**kwargs}

    def control(self,**kwargs):self.path.with_name('state.json.control.json').write_text(json.dumps(kwargs))

    async def test_arms_with_metadata_only_and_binds_exact_fresh_app(self):
        self.assertEqual((await self.watch.step())['status'],'armed');self.assertEqual(self.provider.stops,[])
        self.provider.apps=[self.own()];out=await self.watch.step();self.assertEqual(out['appId'],'ap-owned');self.assertEqual(out['status'],'watching');self.assertFalse(out['cloudStopped'])

    async def test_completed_provider_observation_uses_current_heartbeat(self):
        original=self.provider.observe
        async def slow_read(state):
            self.now+=12500
            return await original(state)
        self.provider.observe=slow_read
        out=await self.watch.step()
        self.assertEqual(out['heartbeatAt'],NOW+12500)
        self.assertEqual(out['status'],'armed')
        self.assertFalse(self.provider.stops)

    async def test_deadline_crossed_during_read_stops_without_another_cycle(self):
        self.provider.apps=[self.own()]
        self.now=lease()['deadline']-1000
        original=self.provider.observe
        async def crossing_read(state):
            self.now+=1500
            return await original(state)
        self.provider.observe=crossing_read
        out=await self.watch.step()
        self.assertEqual(out['stopReason'],'TRIAL_DEADLINE_REACHED')
        self.assertTrue(out['cloudStopped'])
        self.assertEqual(len(self.provider.stops),1)

    async def test_completed_controller_stops_only_owned_app_and_confirms_zero(self):
        self.provider.apps=[self.own()];await self.watch.step();self.control(mainStatus='completed');out=await self.watch.step();self.assertEqual(out['status'],'stopped');self.assertTrue(out['cloudStopped']);self.assertEqual(self.provider.stops,[('ap-owned',lease()['appName'],'main')])

    async def test_control_file_is_not_overwritten_and_late_app_is_stopped(self):
        self.control(stopRequested=True);self.assertEqual((await self.watch.step())['status'],'stop_pending_no_app');self.assertFalse(self.watch.done)
        self.provider.apps=[self.own()];out=await self.watch.step();self.assertEqual(out['status'],'stopped');self.assertTrue(json.loads(self.path.with_name('state.json.control.json').read_text())['stopRequested'])

    async def test_noapp_does_not_mean_stopped_until_no_dispatch_proof(self):
        self.now=lease()['deadline'];out=await self.watch.step();self.assertEqual(out['status'],'stop_pending_no_app');self.assertFalse(out['cloudStopped']);self.control(finishedNotDispatched=True,mainStatus='failed');self.assertEqual((await self.watch.step())['status'],'finished_not_dispatched')

    async def test_deadline_and_cost_guard_request_scoped_stop(self):
        self.provider.apps=[self.own()];self.provider.gross='24.34874585';out=await self.watch.step();self.assertEqual(out['stopReason'],'TRIAL_COST_GUARD_REACHED');self.assertTrue(out['cloudStopped'])

    async def test_unknown_stop_never_claims_zero_and_remains_polling(self):
        self.provider.apps=[self.own()];self.provider.confirm=False;self.control(stopRequested=True);out=await self.watch.step();self.assertEqual(out['status'],'stop_pending');self.assertFalse(out['cloudStopped']);self.assertFalse(self.watch.done)

    async def test_provider_failure_after_bind_stops_known_app_without_logging_error(self):
        self.provider.apps=[self.own()];await self.watch.step();self.provider.error=True;out=await self.watch.step();self.assertEqual(out['status'],'stopped');self.assertEqual(out['stopReason'],'TRIAL_PROVIDER_STATE_UNKNOWN');self.assertNotIn('secret',self.path.read_text())

    async def test_unrelated_app_blocks_without_stopping_it(self):
        self.provider.apps=[self.own(id='ap-other',name='other-app')];out=await self.watch.step();self.assertEqual(out['stopReason'],'TRIAL_OTHER_APP_ACTIVE');self.assertEqual(self.provider.stops,[])

    async def test_old_same_name_is_never_bound_or_stopped(self):
        self.provider.apps=[self.own(createdAt=NOW-10000)];out=await self.watch.step();self.assertEqual(out['stopReason'],'TRIAL_APP_SCOPE_UNCONFIRMED');self.assertIsNone(self.watch.bound);self.assertEqual(self.provider.stops,[])

    async def test_changed_lease_stops_original_not_replacement(self):
        self.provider.apps=[self.own()];await self.watch.step();changed=json.loads(self.path.read_text());changed['appName']='mashhad-flux-ffffffffffff';self.path.write_text(json.dumps(changed));out=await self.watch.step();self.assertEqual(out['stopReason'],'TRIAL_LEASE_CHANGED');self.assertEqual(self.provider.stops[0][0],'ap-owned')

    def test_invalid_scope_budget_staleproof_and_rollover_fail_before_watch(self):
        for override in [{'approved':False},{'account':'other'},{'env':'other'},{'usageLimitUSD':42.5},{'trialMaxUSD':21},{'providerBudgetVerifiedAt':NOW-300001},{'deadline':NOW+46*60000},{'periodEndISO':'2026-10-31T19:15:00Z'}]:
            with self.subTest(override=override),self.assertRaises(ValueError):validate_lease({**lease(),**override},NOW)
        self.assertEqual(timestamp('2026-10-01Z'),timestamp('2026-10-01T00:00:00Z'))


spec=importlib.util.spec_from_file_location('trial_bridge',ROOT/'flux_modal_bridge.py');bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)


class BridgeTests(unittest.IsolatedAsyncioTestCase):
    async def test_metadata_reads_real_sdk_taskstats_without_false_zero(self):
        from modal_proto import api_pb2 as api
        app=api.AppListResponse.AppListItem(app_id='ap-owned',name='mashhad-flux-abcdef123456',description='mashhad-flux-abcdef123456',state=api.APP_STATE_DEPLOYED)
        fake=SimpleNamespace(_stub=SimpleNamespace(AppList=AsyncMock(return_value=api.AppListResponse(apps=[app])),TaskList=AsyncMock(return_value=api.TaskListResponse(tasks=[api.TaskStats(task_id='ta-owned',app_id='ap-owned')]))))
        with patch('modal.client._Client.from_credentials',AsyncMock(return_value=fake)):
            out=await bridge._metadata({'appName':app.name,'credentials':{'tokenId':'synthetic','tokenSecret':'synthetic'}})
        self.assertEqual(out['activeTasks'],1);self.assertEqual(out['containerIds'],['ta-owned'])

    async def test_missing_task_id_is_unknown_not_confirmed_zero(self):
        from modal_proto import api_pb2 as api
        app=api.AppListResponse.AppListItem(app_id='ap-owned',name='x',state=api.APP_STATE_DEPLOYED)
        fake=SimpleNamespace(_stub=SimpleNamespace(AppList=AsyncMock(return_value=api.AppListResponse(apps=[app])),TaskList=AsyncMock(return_value=api.TaskListResponse(tasks=[api.TaskStats()]))))
        with patch('modal.client._Client.from_credentials',AsyncMock(return_value=fake)),self.assertRaisesRegex(ValueError,'FLUX_TASK_SCOPE_INVALID'):
            await bridge._metadata({'appName':'x','credentials':{'tokenId':'synthetic','tokenSecret':'synthetic'}})

    def test_flux_lifecycle_override_keeps_exact_bounds(self):
        calls=[]
        class Remote:
            def with_options(self,**kwargs):calls.append(kwargs);return self
            def __call__(self,**kwargs):return kwargs
        fake=SimpleNamespace(Cls=SimpleNamespace(from_name=lambda *a,**kw:Remote()))
        d={'modelId':'flux2-klein-4b','gpu':'L40S','cpu':4,'ramGiB':64,'timeout':300,'startupTimeout':180,'idleSeconds':2}
        with patch.dict(sys.modules,{'modal':fake}):bridge.cls({'definition':d,'appName':'x','runId':'run'},'client')
        self.assertEqual(calls[0]['scaledown_window'],2);self.assertEqual(calls[0]['timeout'],300);self.assertNotIn('startup_timeout',calls[0]);self.assertNotIn('min_containers',calls[0]);
        import inspect,modal
        inspect.signature(modal.Cls.with_options).bind(None,**calls[0])
        with patch.dict(sys.modules,{'modal':fake}),self.assertRaisesRegex(ValueError,'FLUX_INVALID_DEPLOYMENT'):
            bridge.cls({'definition':{**d,'timeout':True},'appName':'x','runId':'run'},'client')


if __name__=='__main__':unittest.main()
