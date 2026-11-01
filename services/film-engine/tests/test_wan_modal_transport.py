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
MANIFEST=json.loads((ROOT/'wan/model-manifest.json').read_text())
PNG=b'\x89PNG\r\n\x1a\n'+b'0'*32
MP4=bytes.fromhex('000000186674797069736f6d')+b'0'*64


def packet(action):
    engine='a1234567-1234-1234-1234-123456789012';account='account-one'
    return {'action':action,'credentials':{'tokenId':'ak-synthetic_private_token','tokenSecret':'as-synthetic_private_secret','expectedWorkspace':'fixture'},'definition':{'id':engine,'accountId':account,'modelId':'wan22-i2v-a14b','version':'2.2','gpu':'RTX-PRO-6000','cpu':4,'ramGiB':128,'volume':'weights','weightPath':'models/wan22-i2v-a14b/'+engine},'manifest':MANIFEST,'manifestFingerprint':bridge.fingerprint(MANIFEST),'appName':'mashhad-wan-'+engine.replace('-','')[:12],'resultsVolume':'mashhad-wan-results-'+hashlib.sha256(engine.encode()).hexdigest()[:16],'runId':'run-one','requestId':'request-one','paidApproved':True,'operationId':'operation-one','request':{'prompt':'A person','width':720,'height':1280,'seed':42,'mode':'image_to_video','num_frames':81,'fps':16}}


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
            def from_name(app,name,**kwargs):assert name=='WanEngine';return Remote()
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
        self.spawns.append(('generate',request,scope));meta={'sha256':hashlib.sha256(MP4).hexdigest(),'width':request['width'],'height':request['height'],'revision':MANIFEST['revision'],'seed':42,'steps':40,'guidanceScale':3.5,'guidanceScale2':3.5,'numFrames':81,'fps':16,'durationMs':5062.5,'audio':False};value={'scope':scope,'status':'completed','modelRevision':MANIFEST['revision'],'metadata':meta}
        prefix='runs/'+scope['runId']+'/results/'+scope['requestId'];self.files[prefix+'.json']=json.dumps(value).encode();self.files[prefix+'.mp4']=MP4
        call=Call('fc-generate',{**value,'mp4Bytes':MP4});self.calls[call.object_id]=call;return call
    def spawn_prepare(self,request):
        self.spawns.append(('prepare',request));call=Call('fc-prepare',{'scope':request['scope'],'status':'completed','cloudStopped':True});self.calls[call.object_id]=call;return call


class Tests(unittest.TestCase):
    def test_wan_timeouts_cover_approved_heavy_job_without_changing_image_models(self):
        self.assertEqual(bridge.model_config(packet('generate'))['timeout'],1800)
        self.assertEqual(bridge.model_config(packet('generate'))['waitSeconds'],2000)
        self.assertEqual(bridge.MODELS['flux2-klein-4b']['timeout'],600)
        self.assertEqual(bridge.MODELS['qwen-image-edit-2511']['timeout'],600)

    def test_wan_pinned_manifest_namespace_and_approval(self):
        p=packet('inspect');self.assertEqual(bridge.validate(p)[1]['modelId'],'wan22-i2v-a14b');p['appName']=p['appName'].replace('wan','flux')
        with self.assertRaisesRegex(ValueError,'FLUX_SCOPE_INVALID'):bridge.validate(p)
        p=packet('generate');p['paidApproved']=False
        with patch.object(bridge,'client',side_effect=AssertionError('must not call SDK')):
            with self.assertRaisesRegex(ValueError,'FLUX_APPROVAL_REQUIRED'):bridge.dispatch(p)

    def test_wan_mp4_rpc_and_recovery_never_spawn_again(self):
        sdk=SDK();info={'appId':'ap-scoped','activeTasks':1,'containerIds':['task-scoped'],'deploymentRequired':False}
        with patch.dict(sys.modules,{'modal':sdk.module}),patch.object(bridge,'client',return_value='account-client'),patch.object(bridge,'metadata',return_value=info),patch.object(bridge,'emit'):
            p=packet('generate');p['referenceImagesBase64']=[base64.b64encode(PNG).decode()];result=bridge.dispatch(p)
            self.assertEqual(base64.b64decode(result['videoBase64']),MP4);self.assertEqual(result['mime'],'video/mp4');self.assertEqual(result['durationMs'],5062.5);self.assertFalse(result['metadata']['hasAudio']);self.assertEqual(result['numFrames'],81);self.assertEqual(sdk.spawns[-1][1]['reference_images'],[PNG]);self.assertEqual(sdk.spawns[-1][1]['fps'],16);self.assertEqual(sdk.options[-1]['timeout'],1800)
            before=len(sdk.spawns);saved=bridge.dispatch(packet('observe_result'));self.assertEqual(saved['videoBase64'],result['videoBase64']);self.assertEqual(len(sdk.spawns),before)

    def test_wan_rejects_corrupt_audio_or_wrong_timing_receipts(self):
        sdk=SDK();p=packet('generate');call=sdk.spawn_generate(p['request'],bridge.scope(p));value=call.result
        bad={**value,'metadata':{**value['metadata'],'audio':True}}
        with self.assertRaisesRegex(ValueError,'WAN_RESULT_SETTINGS_MISMATCH'):bridge.shape_video(bad,p)
        bad={**value,'metadata':{**value['metadata'],'durationMs':10000}}
        with self.assertRaisesRegex(ValueError,'WAN_RESULT_SETTINGS_MISMATCH'):bridge.shape_video(bad,p)
        with self.assertRaisesRegex(ValueError,'WAN_RESULT_UNCONFIRMED'):bridge.shape_video({**value,'mp4Bytes':b'not-mp4'},p)

    def test_wan_preparation_bootstrap_is_explicit_and_own_package_only(self):
        sdk=SDK();deploy=[]
        with patch.dict(sys.modules,{'modal':sdk.module,'wan.deploy':SimpleNamespace(deploy_wan_app=lambda p,client:deploy.append(p))}),patch.object(bridge,'client',return_value='account-client'),patch.object(bridge,'metadata',return_value={'deploymentRequired':True}),patch.object(bridge,'emit'):
            result=bridge.dispatch(packet('prepare'));self.assertEqual(result['functionCallId'],'fc-prepare');self.assertEqual(len(deploy),1);self.assertEqual(deploy[0]['manifest']['modelId'],'wan22-i2v-a14b');self.assertTrue(deploy[0]['paidApproved'])

if __name__=='__main__':unittest.main()
