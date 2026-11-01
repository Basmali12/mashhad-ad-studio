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
MANIFEST=json.loads((ROOT/'qwen/model-manifest.json').read_text())
PNG=b'\x89PNG\r\n\x1a\n'+b'0'*32


def packet(action):
    engine='a1234567-1234-1234-1234-123456789012';account='account-one'
    return {'action':action,'credentials':{'tokenId':'ak-synthetic_private_token','tokenSecret':'as-synthetic_private_secret','expectedWorkspace':'fixture'},'definition':{'id':engine,'accountId':account,'modelId':'qwen-image-edit-2511','version':'2511','gpu':'RTX-PRO-6000','cpu':4,'ramGiB':128,'volume':'weights','weightPath':'models/qwen-image-edit-2511/'+engine},'manifest':MANIFEST,'manifestFingerprint':bridge.fingerprint(MANIFEST),'appName':'mashhad-qwen-'+engine.replace('-','')[:12],'resultsVolume':'mashhad-qwen-results-'+hashlib.sha256(engine.encode()).hexdigest()[:16],'runId':'run-one','requestId':'request-one','paidApproved':True,'operationId':'operation-one','request':{'prompt':'A person','width':720,'height':1280,'seed':42,'mode':'edit'}}


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
            def from_name(app,name,**kwargs):assert name=='QwenEngine';return Remote()
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
        self.spawns.append(('generate',request,scope));meta={'sha256':hashlib.sha256(PNG).hexdigest(),'width':request['width'],'height':request['height'],'revision':MANIFEST['revision'],'seed':42,'steps':40,'guidanceScale':1.0,'trueCfgScale':4.0};value={'scope':scope,'status':'completed','modelRevision':MANIFEST['revision'],'metadata':meta}
        prefix='runs/'+scope['runId']+'/results/'+scope['requestId'];self.files[prefix+'.json']=json.dumps(value).encode();self.files[prefix+'.png']=PNG
        call=Call('fc-generate',{**value,'pngBytes':PNG});self.calls[call.object_id]=call;return call
    def spawn_prepare(self,request):
        self.spawns.append(('prepare',request));call=Call('fc-prepare',{'scope':request['scope'],'status':'completed','cloudStopped':True});self.calls[call.object_id]=call;return call


class Tests(unittest.TestCase):
    def test_qwen_pinned_model_manifest_namespace_and_approval(self):
        p=packet('inspect');self.assertEqual(bridge.validate(p)[1]['modelId'],'qwen-image-edit-2511')
        p['manifestFingerprint']='wrong'
        with self.assertRaisesRegex(ValueError,'FLUX_PROFILE_CHANGED'):bridge.validate(p)
        p=packet('start');p['paidApproved']=False
        with patch.object(bridge,'client',side_effect=AssertionError('must not call SDK')):
            with self.assertRaisesRegex(ValueError,'FLUX_APPROVAL_REQUIRED'):bridge.dispatch(p)
        p=packet('inspect');p['appName']=p['appName'].replace('qwen','flux')
        with self.assertRaisesRegex(ValueError,'FLUX_SCOPE_INVALID'):bridge.validate(p)

    def test_qwen_rpc_uses_own_class_bytes_and_fixed_40_step_metadata(self):
        sdk=SDK();info={'appId':'ap-scoped','activeTasks':1,'containerIds':['task-scoped'],'deploymentRequired':False}
        with patch.dict(sys.modules,{'modal':sdk.module}),patch.object(bridge,'client',return_value='account-client'),patch.object(bridge,'metadata',return_value=info),patch.object(bridge,'emit'):
            started=bridge.dispatch(packet('start'));self.assertEqual(started['functionCallId'],'fc-start')
            p=packet('generate');p['referenceImagesBase64']=[base64.b64encode(PNG).decode()]
            result=bridge.dispatch(p);self.assertEqual(result['steps'],40);self.assertEqual(result['trueCfgScale'],4);self.assertEqual(result['guidanceScale'],1);self.assertEqual(base64.b64decode(result['imageBase64']),PNG);self.assertEqual(sdk.spawns[-1][1]['reference_images'],[PNG]);self.assertEqual(result['modelRevision'],MANIFEST['revision'])
            before=len(sdk.spawns);saved=bridge.dispatch(packet('observe_result'));self.assertEqual(saved['imageBase64'],result['imageBase64']);self.assertEqual(len(sdk.spawns),before)

    def test_qwen_preparation_bootstrap_is_explicit_and_import_is_allowlisted(self):
        sdk=SDK();deploy=[]
        with patch.dict(sys.modules,{'modal':sdk.module,'qwen.deploy':SimpleNamespace(deploy_qwen_app=lambda p,client:deploy.append(p))}),patch.object(bridge,'client',return_value='account-client'),patch.object(bridge,'metadata',return_value={'deploymentRequired':True}),patch.object(bridge,'emit'):
            result=bridge.dispatch(packet('prepare'));self.assertEqual(result['functionCallId'],'fc-prepare');self.assertEqual(len(deploy),1);self.assertEqual(deploy[0]['manifest']['modelId'],'qwen-image-edit-2511');self.assertEqual(deploy[0]['scope']['runId'],'operation-one');self.assertTrue(deploy[0]['paidApproved'])

    def test_qwen_wrong_quality_receipt_is_not_accepted(self):
        p=packet('generate');value={'scope':bridge.scope(p),'pngBytes':PNG,'metadata':{'width':720,'height':1280,'sha256':hashlib.sha256(PNG).hexdigest(),'revision':MANIFEST['revision'],'steps':4,'guidanceScale':1,'trueCfgScale':4}}
        with self.assertRaisesRegex(ValueError,'QWEN_RESULT_SETTINGS_MISMATCH'):bridge.shape_image(value,p)

if __name__=='__main__':unittest.main()
