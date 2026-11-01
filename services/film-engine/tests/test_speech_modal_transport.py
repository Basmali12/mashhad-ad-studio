"""Local speech RPC composition; fake SDK only and synthetic WAV bytes."""
import base64,hashlib,importlib.util,io,json,sys,wave
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]/'engine'
spec=importlib.util.spec_from_file_location('speech_bridge_tested',ROOT/'flux_modal_bridge.py');bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)
def wav(rate,seconds):
    b=io.BytesIO()
    with wave.open(b,'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(rate);w.writeframes(b'\0'*(rate*seconds*2))
    return b.getvalue()
REF=wav(16000,5);WAV=wav(24000,1)
def sha(value):return hashlib.sha256(value.encode() if isinstance(value,str) else value).hexdigest()
def packet(action,model='habibi-irq'):
    manifest=json.loads((ROOT/'speech/manifests'/(model+'.json')).read_text());engine='engine-one';namespace='speech-'+model;locale={'habibi-irq':'ar-IQ','habibi-egy':'ar-EG','habibi-msa':'ar-MSA','audar-tts-v1-flash':'ar'}[model]
    return {'action':action,'licenseAccepted':True,'codecLicenseAccepted':True,'paidApproved':True,'credentials':{'tokenId':'ak-synthetic_private_token','tokenSecret':'as-synthetic_private_secret','expectedWorkspace':'fixture'},'definition':{'id':engine,'accountId':'account','modelId':model,'version':manifest['version'],'gpu':'L40S','cpu':2,'ramGiB':16,'volume':'weights','weightPath':'models/'+model+'/'+engine},'manifest':manifest,'manifestFingerprint':bridge.fingerprint(manifest),'appName':'mashhad-'+namespace+'-'+engine.replace('-','')[:12],'resultsVolume':'mashhad-'+namespace+'-results-'+sha(engine)[:16],'runId':'run','requestId':'attempt','operationId':'preparation','referenceAudioBase64':base64.b64encode(REF).decode(),'request':{'text':'أهلاً صديقي','referenceTranscript':'هذا صوتي المرجعي','referenceSHA256':sha(REF),'voiceProfileId':'profile','voiceProfileFingerprint':'f'*64,'characterId':'char','narrator':False,'utteranceId':'u1','locale':locale,'expression':'neutral','seed':42}}
class SDK:
    def __init__(self,p,codec=True):
        sdk=self;self.p=p;self.calls=[];self.files={};self.secret_checks=[];self.spawns=[];self.options=[]
        class Volume:
            @staticmethod
            def from_name(name,**kw):assert kw['create_if_missing'] is False;return Volume()
            def listdir(self,*a,**k):return []
            def read_file(self,path):
                if path not in sdk.files:raise FileNotFoundError()
                yield sdk.files[path]
        class Remote:
            def with_options(self,**kw):sdk.options.append(kw);return self
            def __call__(self,**kw):assert kw['runtime_id']==p['runId'];return self
            @property
            def generate(self):return SimpleNamespace(spawn=sdk.generate)
        class Cls:
            @staticmethod
            def from_name(app,name,**kw):assert name=='SpeechEngine';assert app==p['appName'];return Remote()
        class Secret:
            @staticmethod
            def from_name(name,**kw):
                sdk.secret_checks.append((name,kw))
                def hydrate():
                    if not codec:raise RuntimeError('authorization absent')
                return SimpleNamespace(hydrate=hydrate)
        class Function:
            @staticmethod
            def from_name(app,name,**kw):return SimpleNamespace(hydrate=lambda:None,spawn=sdk.prepare)
        self.module=SimpleNamespace(Cls=Cls,Volume=Volume,Secret=Secret,Function=Function)
    def prepare(self,p):self.spawns.append(('prepare',p));return SimpleNamespace(object_id='fc-prepare')
    def generate(self,r,scope):
        self.spawns.append(('generate',r,scope));assert r['reference_audio']==REF
        m={k:r[k] for k in ('voiceProfileId','voiceProfileFingerprint','characterId','narrator','utteranceId','locale','expression','seed')};m.update({'sampleRate':24000,'channels':1,'sampleWidth':2,'numSamples':24000,'durationMs':1000,'sha256':sha(WAV),'bytes':len(WAV),'format':'pcm_s16le','textSHA256':sha(r['text']),'referenceSHA256':sha(REF),'referenceTranscriptSHA256':sha(r['referenceTranscript']),'modelId':self.p['manifest']['modelId'],'version':self.p['manifest']['version'],'revision':self.p['manifest']['revision']})
        result={'scope':scope,'modelRevision':m['revision'],'metadata':m,'wavBytes':WAV};prefix='runs/'+scope['runId']+'/results/'+scope['requestId'];self.files[prefix+'.json']=json.dumps({k:v for k,v in result.items() if k!='wavBytes'}).encode();self.files[prefix+'.wav']=WAV;return SimpleNamespace(object_id='fc-generate',get=lambda timeout:result)
class Tests(unittest.TestCase):
    def test_all_specialized_models_use_fixed_local_manifest_own_namespace_and_wav_recovery(self):
        for model in ('habibi-irq','habibi-egy','habibi-msa','audar-tts-v1-flash'):
            with self.subTest(model=model):
                p=packet('generate',model);sdk=SDK(p)
                with patch.dict(sys.modules,{'modal':sdk.module}),patch.object(bridge,'client',return_value='scoped-client'),patch.object(bridge,'emit'):
                    result=bridge.dispatch(p);self.assertEqual(base64.b64decode(result['audioBase64']),WAV);self.assertEqual(result['metadata']['modelId'],model);self.assertEqual(result['durationMs'],1000);self.assertEqual(sdk.options[0]['gpu'],'L40S');before=len(sdk.spawns);p['action']='observe_result';saved=bridge.dispatch(p);self.assertEqual(saved['audioBase64'],result['audioBase64']);self.assertEqual(len(sdk.spawns),before)
    def test_audar_license_and_codec_ack_rejected_before_sdk_but_habibi_not_unified_gated(self):
        for flag in ('licenseAccepted','codecLicenseAccepted'):
            p=packet('prepare','audar-tts-v1-flash');p[flag]=False
            with patch.object(bridge,'client',side_effect=AssertionError('no SDK')):
                with self.assertRaisesRegex(ValueError,'SPEECH_LICENSE_ACKNOWLEDGEMENT_REQUIRED'):bridge.dispatch(p)
        p=packet('prepare');p['licenseAccepted']=False;p['codecLicenseAccepted']=False;bridge.validate(p)
    def test_audar_codec_metadata_checks_secret_presence_only_without_receiving_token(self):
        for available in (False,True):
            p=packet('inspect','audar-tts-v1-flash');p['licenseAccepted']=False;sdk=SDK(p,codec=available)
            with patch.dict(sys.modules,{'modal':sdk.module}),patch.object(bridge,'client',return_value='client'),patch.object(bridge,'metadata',return_value={'appId':None,'deploymentRequired':True}):
                result=bridge.dispatch(p);self.assertIsNone(result['codecAuthorized']);self.assertEqual(result['codecAccess']['secretConfigured'],available);self.assertIsNone(result['codecAccess']['authorized']);self.assertEqual(result['codecAccess']['status'],'unverified');self.assertEqual(sdk.spawns,[]);self.assertEqual(sdk.secret_checks[0][0],'mashhad-hf-read');self.assertEqual(sdk.secret_checks[0][1]['client'],'client')
    def test_prepare_forwards_audar_ack_to_existing_worker_without_copying_secrets(self):
        p=packet('prepare','audar-tts-v1-flash');sdk=SDK(p)
        with patch.dict(sys.modules,{'modal':sdk.module}),patch.object(bridge,'client',return_value='client'),patch.object(bridge,'metadata',return_value={'deploymentRequired':False}),patch.object(bridge,'emit'):
            bridge.dispatch(p);r=sdk.spawns[0][1];self.assertTrue(r['licenseAccepted']);self.assertTrue(r['codecLicenseAccepted']);self.assertEqual(r['modelId'],'audar-tts-v1-flash');self.assertNotIn('credentials',r)
    def test_audio_proof_rejects_changed_text_and_invalid_wav(self):
        p=packet('generate');sdk=SDK(p);r={**p['request'],'reference_audio':REF};value=sdk.generate(r,bridge.scope(p)).get(1)
        bad={**value,'metadata':{**value['metadata'],'textSHA256':'0'*64}}
        with self.assertRaisesRegex(ValueError,'SPEECH_RESULT_SCOPE_INVALID'):bridge.shape_audio(bad,p)
        with self.assertRaisesRegex(ValueError,'SPEECH_RESULT_UNCONFIRMED'):bridge.shape_audio({**value,'wavBytes':b'not-a-WAV'},p)
    def test_native_speaking_rate_survives_metadata_shaping_and_rejects_mismatch(self):
        p=packet('generate','habibi-msa');p['request']['speakingRate']=0.9;sdk=SDK(p)
        value=sdk.generate({**p['request'],'reference_audio':REF},bridge.scope(p)).get(1)
        value['metadata']['speakingRate']=0.9
        result=bridge.shape_audio(value,p)
        self.assertEqual(result['metadata']['speakingRate'],0.9)
        with self.assertRaisesRegex(ValueError,'SPEECH_RESULT_SCOPE_INVALID'):
            bridge.shape_audio({**value,'metadata':{**value['metadata'],'speakingRate':1}},p)
        observed={k:v for k,v in p.items() if k!='request'}
        self.assertEqual(bridge.shape_audio(value,observed)['metadata']['speakingRate'],0.9)
if __name__=='__main__':unittest.main()
