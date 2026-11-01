"""Local bridge composition only: fake SDK and no network/build/model execution."""
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch,AsyncMock

ROOT=Path(__file__).resolve().parents[1]/'engine'
spec=importlib.util.spec_from_file_location('flux_bridge_tested',ROOT/'flux_modal_bridge.py')
bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)
MANIFEST=json.loads((ROOT/'flux/model-manifest.json').read_text())
PNG=b'\x89PNG\r\n\x1a\n'+b'0'*32


def packet(action):
    engine='a1234567-1234-1234-1234-123456789012';account='account-one'
    return {'action':action,'credentials':{'tokenId':'ak-synthetic_private_token','tokenSecret':'as-synthetic_private_secret','expectedWorkspace':'fixture'},'definition':{'id':engine,'accountId':account,'modelId':'flux2-klein-4b','version':'4B','gpu':'RTX-PRO-6000','cpu':4,'ramGiB':96,'volume':'weights','weightPath':'models/flux2-klein-4b/'+engine},'manifest':MANIFEST,'manifestFingerprint':bridge.fingerprint(MANIFEST),'appName':'mashhad-flux-'+engine.replace('-','')[:12],'resultsVolume':'mashhad-flux-results-'+hashlib.sha256(engine.encode()).hexdigest()[:16],'runId':'run-one','requestId':'request-one','paidApproved':True,'operationId':'operation-one','request':{'prompt':'A person','width':720,'height':1280,'seed':42,'mode':'text_to_image'}}


class Call:
    def __init__(self,id,result=None,error=None):self.object_id=id;self.result=result;self.error=error;self.cancelled=[]
    def get(self,timeout=None):
        if self.error:raise self.error
        return self.result
    def cancel(self,terminate_containers=False):self.cancelled.append(terminate_containers)


class SDK:
    def __init__(self):
        self.files={};self.entries=[];self.calls={};self.spawns=[];self.reads=[];self.options=[];self.hydrations=0
        sdk=self
        class Volume:
            @staticmethod
            def from_name(name,**kwargs):
                assert kwargs['create_if_missing'] is False
                return Volume()
            def listdir(self,prefix,recursive=False):return sdk.entries
            def read_file(self,path):
                sdk.reads.append(path)
                if path not in sdk.files:raise FileNotFoundError()
                yield sdk.files[path]
        class Remote:
            def with_options(self,**kwargs):sdk.options.append(kwargs);return self
            def hydrate(self):sdk.hydrations+=1;return self
            @property
            def object_id(self):return 'cs-scoped'
            def __call__(self,**kwargs):sdk.runtime_id=kwargs['runtime_id'];return self
            @property
            def start(self):return SimpleNamespace(spawn=lambda scope:sdk.spawn_start(scope))
            @property
            def generate(self):return SimpleNamespace(spawn=lambda request,scope:sdk.spawn_generate(request,scope))
        class Cls:
            @staticmethod
            def from_name(app,name,**kwargs):assert name=='KleinEngine';return Remote()
        class Function:
            @staticmethod
            def from_name(app,name,**kwargs):
                assert name=='prepare_models'
                return SimpleNamespace(hydrate=lambda:None,spawn=lambda request:sdk.spawn_prepare(request))
        class FunctionCall:
            @staticmethod
            def from_id(id,**kwargs):return sdk.calls[id]
        class Cancelled(BaseException):pass
        self.module=SimpleNamespace(Cls=Cls,Volume=Volume,Function=Function,FunctionCall=FunctionCall,exception=SimpleNamespace(InputCancellation=Cancelled,FunctionTimeoutError=type('FunctionTimeoutError',(Exception,),{})))
    def spawn_start(self,scope):
        self.spawns.append(('start',scope));call=Call('fc-start',{'engineId':scope['engineId'],'accountId':scope['accountId'],'runId':scope['runId'],'ready':True,'modelRevision':MANIFEST['revision']});self.calls[call.object_id]=call;return call
    def spawn_generate(self,request,scope):
        self.spawns.append(('generate',request,scope));meta={'sha256':hashlib.sha256(PNG).hexdigest(),'width':request['width'],'height':request['height'],'revision':MANIFEST['revision'],'seed':42,'steps':4,'guidanceScale':1.0};value={'scope':scope,'status':'completed','modelRevision':MANIFEST['revision'],'metadata':meta}
        prefix='runs/'+scope['runId']+'/results/'+scope['requestId'];self.files[prefix+'.json']=json.dumps(value).encode();self.files[prefix+'.png']=PNG
        call=Call('fc-generate',{**value,'pngBytes':PNG});self.calls[call.object_id]=call;return call
    def spawn_prepare(self,request):
        self.spawns.append(('prepare',request));call=Call('fc-prepare',{'scope':request['scope'],'status':'completed','cloudStopped':True});self.calls[call.object_id]=call;return call


class Tests(unittest.TestCase):
    def test_failed_prepare_is_terminal_without_exposing_remote_error_or_retry(self):
        sdk=SDK();p=packet('observe_preparation');p['functionCallId']='fc-prepare'
        sdk.calls['fc-prepare']=Call('fc-prepare',error=ValueError('private remote traceback'))
        with patch.dict(sys.modules,{'modal':sdk.module}),patch.object(bridge,'client',return_value='account-client'),patch.object(bridge,'preparation_failed',return_value=True),patch.object(bridge,'metadata',return_value={'activeTasks':0}):
            result=bridge.dispatch(p)
        self.assertEqual(result,{'status':'failed','error':'FLUX_PREPARATION_FAILED','progress':None,'cloudStopped':True})
        self.assertFalse(sdk.spawns)

    def test_unconfirmed_prepare_error_never_claims_stopped(self):
        sdk=SDK();p=packet('observe_preparation');p['functionCallId']='fc-prepare'
        sdk.calls['fc-prepare']=Call('fc-prepare',error=ConnectionError('private detail'))
        with patch.dict(sys.modules,{'modal':sdk.module}),patch.object(bridge,'client',return_value='account-client'),patch.object(bridge,'preparation_failed',return_value=False):
            with self.assertRaisesRegex(ValueError,'FLUX_RESULT_UNCONFIRMED'):bridge.dispatch(p)
        self.assertFalse(sdk.spawns)

    def test_prepare_failure_requires_nonempty_pinned_terminal_failure_metadata(self):
        from modal.client import _Client
        from modal_proto import api_pb2 as api
        response=api.FunctionGetOutputsResponse(num_unfinished_inputs=0,outputs=[api.FunctionGetOutputsItem(result=api.GenericResult(status=api.GenericResult.GENERIC_STATUS_FAILURE))])
        stub=SimpleNamespace(FunctionGetOutputs=AsyncMock(return_value=response))
        p=packet('observe_preparation');p['functionCallId']='fc-prepare'
        with patch.object(_Client,'from_credentials',new=AsyncMock(return_value=SimpleNamespace(_stub=stub))):
            self.assertTrue(bridge.asyncio.run(bridge._preparation_failed(p)))
            self.assertFalse(stub.FunctionGetOutputs.await_args.args[0].clear_on_success)
            for response in (api.FunctionGetOutputsResponse(),api.FunctionGetOutputsResponse(num_unfinished_inputs=1),api.FunctionGetOutputsResponse(outputs=[api.FunctionGetOutputsItem(result=api.GenericResult(status=api.GenericResult.GENERIC_STATUS_SUCCESS))])):
                stub.FunctionGetOutputs.return_value=response
                self.assertFalse(bridge.asyncio.run(bridge._preparation_failed(p)))

    def test_import_is_inert_and_missing_approval_precedes_sdk_or_client(self):
        p=packet('start');p['paidApproved']=False
        with patch.object(bridge,'client',side_effect=AssertionError('SDK must not be reached')):
            with self.assertRaisesRegex(ValueError,'FLUX_APPROVAL_REQUIRED'):bridge.dispatch(p)
        p=packet('start');p['manifestFingerprint']='wrong'
        with self.assertRaisesRegex(ValueError,'FLUX_PROFILE_CHANGED'):bridge.validate(p)

    def test_full_start_observe_generate_and_saved_result_compose_actual_rpc_shape(self):
        sdk=SDK();info={'appId':'ap-scoped','activeTasks':1,'containerIds':['task-scoped'],'deploymentRequired':False}
        with patch.dict(sys.modules,{'modal':sdk.module}),patch.object(bridge,'client',return_value='account-client'),patch.object(bridge,'metadata',return_value=info),patch.object(bridge,'call_statuses',return_value=True),patch.object(bridge,'emit') as event:
            started=bridge.dispatch(packet('start'));self.assertEqual(started['functionCallId'],'fc-start');self.assertFalse(started['ready'])
            p=packet('observe');p['functionCallId']='fc-start';p['admissionClosed']=False
            self.assertTrue(bridge.dispatch(p)['ready'])
            p=packet('generate');p['request']['mode']='edit';p['referenceImagesBase64']=[base64.b64encode(PNG).decode()]
            generated=bridge.dispatch(p);self.assertEqual(base64.b64decode(generated['imageBase64']),PNG);self.assertEqual(generated['modelRevision'],MANIFEST['revision']);self.assertEqual(sdk.spawns[-1][1]['reference_images'],[PNG]);self.assertEqual(sdk.options[-1]['retries'],0);self.assertEqual(sdk.options[-1]['buffer_containers'],0)
            before=len(sdk.spawns);saved=bridge.dispatch(packet('observe_result'));self.assertEqual(saved['imageBase64'],generated['imageBase64']);self.assertEqual(len(sdk.spawns),before);self.assertTrue(event.called)

    def test_readonly_inspection_reads_marker_and_deployment_only_not_weights(self):
        sdk=SDK();p=packet('inspect');d=p['definition'];prefix=d['weightPath'];marker={'hashVerified':True,'engineId':d['id'],'accountId':d['accountId'],'revision':MANIFEST['revision'],'modelId':MANIFEST['modelId'],'manifestFingerprint':p['manifestFingerprint'],'files':MANIFEST['files']}
        sdk.files[prefix+'/READY.json']=json.dumps(marker).encode();sdk.entries=[SimpleNamespace(path=prefix+'/'+f['path'],size=f['size']) for f in MANIFEST['files']]+[SimpleNamespace(path=prefix+'/READY.json',size=len(sdk.files[prefix+'/READY.json']))]
        sdk.files['deployment.json']=json.dumps({'engineId':d['id'],'accountId':d['accountId'],'appId':'ap-scoped','appName':p['appName'],'modelVolume':d['volume'],'resultsVolume':p['resultsVolume'],'weightPath':d['weightPath'],'manifestFingerprint':p['manifestFingerprint'],'modelRevision':MANIFEST['revision'],'classId':'cs-scoped'}).encode()
        with patch.dict(sys.modules,{'modal':sdk.module}),patch.object(bridge,'client',return_value='account-client'),patch.object(bridge,'metadata',return_value={'appId':'ap-scoped','deploymentRequired':False}):
            result=bridge.dispatch(p)
        self.assertTrue(result['ready']);self.assertTrue(result['deploymentReady']);self.assertFalse(result['gpuUsed']);self.assertFalse(sdk.spawns);self.assertEqual(set(sdk.reads),{prefix+'/READY.json','deployment.json'})

    def test_stop_cancels_owned_calls_then_official_graceful_cli_and_never_gpu_rpc(self):
        sdk=SDK();call=Call('fc-owned',{});sdk.calls[call.object_id]=call;p=packet('stop');p.update(admissionClosed=True,functionCallIds=['fc-owned'],appId='ap-scoped',pendingUnknown=False)
        states=[{'appId':'ap-scoped','activeTasks':1,'containerIds':['task-owned'],'deploymentRequired':False},{'appId':'ap-scoped','activeTasks':0,'containerIds':[],'deploymentRequired':False}]
        with patch.dict(sys.modules,{'modal':sdk.module}),patch.object(bridge,'client',return_value='account-client'),patch.object(bridge,'metadata',side_effect=states),patch.object(bridge,'call_statuses',return_value=True),patch.object(bridge.subprocess,'run') as run:
            result=bridge.dispatch(p)
        self.assertTrue(result['cloudStopped']);self.assertEqual(call.cancelled,[False]);self.assertFalse(sdk.spawns);argv=run.call_args.args[0];self.assertEqual(argv[-5:],['container','stop','--graceful','--yes','task-owned']);self.assertNotIn(p['credentials']['tokenSecret'],' '.join(argv));self.assertEqual(run.call_args.kwargs['env']['MODAL_TOKEN_SECRET'],p['credentials']['tokenSecret'])

    def test_zero_tasks_do_not_prove_stop_when_an_unrecorded_dispatch_may_still_allocate(self):
        sdk=SDK();p=packet('stop');p.update(admissionClosed=True,functionCallIds=[],pendingUnknown=True)
        with patch.dict(sys.modules,{'modal':sdk.module}),patch.object(bridge,'client',return_value='account-client'),patch.object(bridge,'metadata',return_value={'appId':'ap-scoped','activeTasks':0,'containerIds':[],'deploymentRequired':False}),patch.object(bridge,'call_statuses',return_value=False):
            self.assertFalse(bridge.dispatch(p)['cloudStopped'])

    def test_queued_known_call_without_terminal_receipt_is_not_stopped_just_because_tasks_are_zero(self):
        sdk=SDK();sdk.calls['fc-queued']=Call('fc-queued',error=TimeoutError());p=packet('stop');p.update(admissionClosed=True,functionCallIds=['fc-queued'],pendingUnknown=False)
        with patch.dict(sys.modules,{'modal':sdk.module}),patch.object(bridge,'client',return_value='account-client'),patch.object(bridge,'metadata',return_value={'appId':'ap-scoped','activeTasks':0,'containerIds':[],'deploymentRequired':False}),patch.object(bridge,'call_statuses',return_value=False):
            self.assertFalse(bridge.dispatch(p)['cloudStopped'])

    def test_idle_zero_tasks_and_terminal_calls_closes_admission_instead_of_reusing_cached_ready(self):
        sdk=SDK();sdk.spawn_start(bridge.scope(packet('start')));p=packet('observe');p.update(functionCallId='fc-start',functionCallIds=['fc-start'],pendingUnknown=False,admissionClosed=False)
        with patch.dict(sys.modules,{'modal':sdk.module}),patch.object(bridge,'client',return_value='account-client'),patch.object(bridge,'metadata',return_value={'appId':'ap-scoped','activeTasks':0,'containerIds':[],'deploymentRequired':False}),patch.object(bridge,'call_statuses',return_value=True):
            result=bridge.dispatch(p)
        self.assertFalse(result['ready']);self.assertTrue(result['cloudStopped']);self.assertTrue(result['admissionClosed']);self.assertTrue(result['startSettled']);self.assertEqual(len(sdk.spawns),1)

    def test_idle_zero_tasks_with_pending_call_never_claims_ready_or_stopped(self):
        sdk=SDK();p=packet('observe');p.update(functionCallId='fc-pending',functionCallIds=['fc-pending'],pendingUnknown=False,admissionClosed=False)
        with patch.dict(sys.modules,{'modal':sdk.module}),patch.object(bridge,'client',return_value='account-client'),patch.object(bridge,'metadata',return_value={'appId':'ap-scoped','activeTasks':0,'containerIds':[],'deploymentRequired':False}),patch.object(bridge,'call_statuses',return_value=False):
            result=bridge.dispatch(p)
        self.assertFalse(result['ready']);self.assertFalse(result['cloudStopped']);self.assertFalse(result['admissionClosed']);self.assertFalse(sdk.spawns)

    def test_late_call_cancellation_uses_control_plane_only(self):
        sdk=SDK();call=Call('fc-late',{});sdk.calls['fc-late']=call;p=packet('cancel_call');p.update(functionCallId='fc-late',admissionClosed=True)
        with patch.dict(sys.modules,{'modal':sdk.module}),patch.object(bridge,'client',return_value='account-client'),patch.object(bridge,'metadata',return_value={'appId':'ap-scoped','activeTasks':0,'containerIds':[],'deploymentRequired':False}),patch.object(bridge,'call_statuses',return_value=True):
            result=bridge.dispatch(p)
        self.assertTrue(result['cloudStopped']);self.assertEqual(call.cancelled,[False]);self.assertFalse(sdk.spawns)

    def test_terminal_proof_uses_pinned_readonly_output_metadata_without_clearing_results(self):
        from modal.client import _Client
        stub=SimpleNamespace(FunctionGetOutputs=AsyncMock(return_value=SimpleNamespace(num_unfinished_inputs=0)))
        p=packet('observe');p['functionCallIds']=['fc-one','fc-two']
        with patch.object(_Client,'from_credentials',new=AsyncMock(return_value=SimpleNamespace(_stub=stub))):
            self.assertTrue(bridge.asyncio.run(bridge._call_statuses(p)))
            self.assertEqual(stub.FunctionGetOutputs.await_count,2)
            request=stub.FunctionGetOutputs.await_args.args[0];self.assertFalse(request.clear_on_success);self.assertEqual(request.timeout,0)
            stub.FunctionGetOutputs.return_value=SimpleNamespace(num_unfinished_inputs=1)
            self.assertFalse(bridge.asyncio.run(bridge._call_statuses(p)))

    def test_prepare_bootstrap_is_only_an_explicit_approved_prepare_then_one_cpu_spawn(self):
        sdk=SDK();p=packet('prepare');deployed=[]
        with patch.dict(sys.modules,{'modal':sdk.module,'flux.deploy':SimpleNamespace(deploy_flux_app=lambda *a,**kw:deployed.append(a[0]))}),patch.object(bridge,'client',return_value='account-client'),patch.object(bridge,'metadata',return_value={'deploymentRequired':True}),patch.object(bridge,'emit'):
            result=bridge.dispatch(p)
        self.assertEqual(len(deployed),1);self.assertEqual(sdk.spawns[0][0],'prepare');self.assertEqual(result['status'],'submitted');self.assertFalse(result['cloudStopped']);self.assertEqual(sdk.spawns[0][1]['manifestFingerprint'],p['manifestFingerprint'])

    def test_cancel_preparation_requires_terminal_proof_not_a_network_error(self):
        sdk=SDK();p=packet('cancel_preparation');p['functionCallId']='fc-prep';call=Call('fc-prep',error=ConnectionError('private'));sdk.calls['fc-prep']=call
        with patch.dict(sys.modules,{'modal':sdk.module}),patch.object(bridge,'client',return_value='account-client'),patch.object(bridge,'metadata',return_value={'activeTasks':0}):
            result=bridge.dispatch(p);self.assertFalse(result['cloudStopped']);call.error=sdk.module.exception.InputCancellation();self.assertTrue(bridge.dispatch(p)['cloudStopped'])
        self.assertEqual(call.cancelled,[True,True]);self.assertFalse(sdk.spawns)

    def test_mismatching_result_or_altered_png_is_rejected(self):
        p=packet('observe_result');good={'scope':bridge.scope(p),'metadata':{'sha256':hashlib.sha256(PNG).hexdigest(),'revision':MANIFEST['revision'],'width':720,'height':1280},'pngBytes':PNG}
        self.assertEqual(bridge.shape_image(good,p)['bytes'],len(PNG))
        with self.assertRaisesRegex(ValueError,'FLUX_RESULT_UNCONFIRMED'):bridge.shape_image({**good,'scope':{**good['scope'],'runId':'other'}},p)
        with self.assertRaisesRegex(ValueError,'FLUX_RESULT_UNCONFIRMED'):bridge.shape_image({**good,'pngBytes':PNG+b'changed'},p)


if __name__=='__main__':unittest.main()
