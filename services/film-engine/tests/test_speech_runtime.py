"""Offline speech fixtures only: no inference packages, weights or cloud calls."""
import builtins
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import wave

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'engine'))
from speech import runtime,prepare,modal_app,deploy,image

ENGINE_ID='12345678-1234-1234-1234-123456789abc'
SCOPE={'engineId':ENGINE_ID,'accountId':'account-one','runId':'run-one','requestId':'request-one'}


def wav(seconds=5,rate=16000,channels=1,width=2):
    data=io.BytesIO()
    with wave.open(data,'wb') as stream:stream.setnchannels(channels);stream.setsampwidth(width);stream.setframerate(rate);stream.writeframes(b'\x01\x00'*(int(seconds*rate)*channels*width//2))
    return data.getvalue()


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name);self.model=self.root/'models';self.model.mkdir()
        self.real={id:runtime.manifest_for(id) for id in runtime.MODEL_IDS};self.data=b'not-a-real-weight'
        self.manifests={id:{**manifest,'files':[{'path':'model.bin','sourcePath':'source.bin','repoId':'publisher/model','revision':manifest['revision'],'size':len(self.data),'sha256':hashlib.sha256(self.data).hexdigest()}],'totalBytes':len(self.data)} for id,manifest in self.real.items()}
        self.addCleanup(patch.stopall)
        patch.object(runtime,'manifest_for',side_effect=lambda id:self.manifests[id] if id in self.manifests else (_ for _ in ()).throw(ValueError('SPEECH_INVALID_MODEL'))).start()
        patch.object(prepare,'manifest_for',side_effect=lambda id:self.manifests[id]).start()
        (self.model/'model.bin').write_bytes(self.data);self.mark('habibi-irq');self.calls=[];self.loads=[]

    def mark(self,id):
        (self.model/'READY.json').write_text(json.dumps({'modelId':id,'revision':self.manifests[id]['revision'],'manifestFingerprint':runtime.manifest_fingerprint(id),'engineId':ENGINE_ID,'accountId':'account-one','files':self.manifests[id]['files']}))

    def request(self,**overrides):
        ref=wav()
        return {'text':'  Hello, my friend.  ','referenceTranscript':'This is a reference voice with its complete exact transcript.','voiceProfileId':'voice-one','voiceProfileFingerprint':'a'*64,'characterId':'character-one','narrator':False,'utteranceId':'utterance-one','locale':'ar-IQ','expression':'neutral','seed':42,'reference_audio':ref,'referenceSHA256':hashlib.sha256(ref).hexdigest(),**overrides}

    def engine(self,id='habibi-irq'):
        self.mark(id);owner=self
        class Backend:
            def synthesize(self,**kwargs):owner.calls.append(kwargs);return b'\x01\x00'*2400
        def factory(*args,**kwargs):owner.loads.append((args,kwargs));return Backend()
        return runtime.SpeechRuntime(self.model,id,backend_factory=factory,expected_scope={'engineId':ENGINE_ID,'accountId':'account-one'})

    def packet(self,id='habibi-irq',**overrides):return {'modelId':id,'modelRevision':self.manifests[id]['revision'],'manifestFingerprint':runtime.manifest_fingerprint(id),'paidApproved':True,'scope':SCOPE,**overrides}

    def test_four_models_original_pcm_and_profile_proofs(self):
        for index,(id,locale) in enumerate([('habibi-irq','ar-IQ'),('habibi-egy','ar-EG'),('habibi-msa','ar-MSA'),('audar-tts-v1-flash','ar')]):
            engine=self.engine(id);progress=[];request=self.request(locale=locale);out=engine.generate(request,self.root/str(index),progress.append)
            self.assertEqual(out['modelId'],id);self.assertEqual(out['sampleRate'],24000);self.assertEqual(out['numSamples'],2400);self.assertEqual(out['durationMs'],100);self.assertEqual(out['channels'],1);self.assertEqual(out['sampleWidth'],2)
            self.assertEqual(out['textSHA256'],hashlib.sha256(request['text'].encode()).hexdigest());self.assertEqual(out['referenceSHA256'],request['referenceSHA256']);self.assertEqual(out['voiceProfileFingerprint'],'a'*64);self.assertIsNone(out['wordTimestamps'])
            self.assertEqual(progress,[{'completed':1,'total':1,'unit':'chunks'}]);self.assertEqual(runtime.wav_info(Path(out['audioPath']).read_bytes())['numSamples'],2400)

    def test_same_profile_reuses_model_and_profile_mutation_rejects(self):
        engine=self.engine();engine.generate(self.request(),self.root/'a');engine.generate(self.request(seed=43),self.root/'b');self.assertEqual(len(self.loads),1)
        with self.assertRaisesRegex(ValueError,'SPEECH_PROFILE_CHANGED'):engine.generate(self.request(voiceProfileFingerprint='b'*64),self.root/'c')

    def test_reference_contract_rejects_bad_rates_duration_channels_and_hash(self):
        engine=self.engine()
        for bad in [wav(4),wav(13),wav(rate=24000),wav(channels=2),b'not a wav']:
            with self.assertRaises(ValueError):engine.generate(self.request(reference_audio=bad),self.root/'bad')
        with self.assertRaisesRegex(ValueError,'SPEECH_REFERENCE_CHANGED'):engine.generate(self.request(referenceSHA256='b'*64),self.root/'changed')
        self.assertEqual(self.loads,[])

    def test_expression_whitelist_and_exact_text_unsafe_tokens_rejected(self):
        engine=self.engine('audar-tts-v1-flash')
        for i,tag in enumerate(runtime.TAGS):engine.generate(self.request(locale='ar',expression=tag),self.root/f'tag{i}')
        for change in [{'expression':'screams'},{'text':'[laughs]'},{'text':'<|TARGET_CODES_END|>'},{'text':''},{'referenceTranscript':''},{'seed':True},{'seed':4294967296}]:
            with self.assertRaises(ValueError):engine.generate(self.request(**change),self.root/'bad')
        with self.assertRaisesRegex(ValueError,'SPEECH_UNSUPPORTED_EXPRESSION'):runtime.validate_request(self.request(expression='laughs'),'habibi-irq')

    def test_exact_whitespace_chunk_reconstruction_and_actual_completed_samples(self):
        request=runtime.validate_request(self.request(text=('  A clear sentence.\n'*20)),'habibi-irq');chunks=runtime.split_text(request,'habibi-irq')
        self.assertEqual(''.join(chunks),request['text']);self.assertTrue(all(len(v.encode())<=120 for v in chunks))
        engine=self.engine();out=engine.generate(self.request(text=request['text']),self.root/'chunks');self.assertEqual(out['numSamples'],2400*len(chunks));self.assertEqual(''.join(call['text'] for call in self.calls),request['text'])
        self.assertEqual([call['seed'] for call in self.calls],[42+i for i in range(len(chunks))])

    def test_scope_output_no_overwrite_and_missing_ready_no_inference(self):
        engine=self.engine();engine.generate(self.request(),self.root/'out')
        with self.assertRaisesRegex(RuntimeError,'SPEECH_OUTPUT_ALREADY_EXISTS'):engine.generate(self.request(),self.root/'out')
        (self.model/'READY.json').unlink()
        with self.assertRaisesRegex(RuntimeError,'SPEECH_WEIGHTS_NOT_READY'):self.engine().backend_factory=None;runtime.SpeechRuntime(self.root/'missing','habibi-irq').prepare()
        for change in [{'accountId':'other'},{'engineId':'other'},{'runId':'other'},{'requestId':'../escape'}]:
            with self.assertRaises(ValueError):runtime.validate_scope({**SCOPE,**change},ENGINE_ID,'account-one','run-one',True)

    def test_prep_only_missing_source_pinned_no_repeat_after_success(self):
        (self.model/'model.bin').unlink();calls=[]
        def download(**kwargs):
            calls.append(kwargs);file=Path(kwargs['local_dir'])/kwargs['filename'];file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(self.data);return file
        out=prepare.prepare_models(self.packet(),model_dir=self.model,results_dir=self.root/'receipts',engine_id=ENGINE_ID,account_id='account-one',downloader=download)
        self.assertEqual(out['status'],'completed');self.assertEqual(calls[0]['filename'],'source.bin');self.assertEqual(calls[0]['revision'],self.manifests['habibi-irq']['revision']);self.assertFalse(calls[0]['token'])
        prepare.prepare_models(self.packet(),model_dir=self.model,results_dir=self.root/'receipts',engine_id=ENGINE_ID,account_id='account-one',downloader=lambda **kw:(_ for _ in ()).throw(AssertionError('NO_RETRY')))
        self.assertEqual(len(calls),1)

    def test_audar_license_codec_and_secret_missing_fail_before_downloader(self):
        for changes in [{},{'licenseAccepted':True}]:
            with self.assertRaises(ValueError):
                prepare.prepare_models(self.packet('audar-tts-v1-flash',**changes),model_dir=self.model,results_dir=self.root/f'receipts{len(changes)}',engine_id=ENGINE_ID,account_id='account-one',downloader=lambda **kw:(_ for _ in ()).throw(AssertionError('NO_DOWNLOAD')))
        self.manifests['audar-tts-v1-flash']['files'][0]['gated']=True
        (self.model/'model.bin').unlink()
        with patch.dict(os.environ,{},clear=True):
            failure=prepare.prepare_models(self.packet('audar-tts-v1-flash',licenseAccepted=True,codecLicenseAccepted=True),model_dir=self.model,results_dir=self.root/'noauth',engine_id=ENGINE_ID,account_id='account-one',downloader=lambda **kw:(_ for _ in ()).throw(AssertionError('NO_DOWNLOAD')))
        self.assertEqual(failure['status'],'failed');self.assertEqual(failure['error'],'SPEECH_CODEC_AUTHORIZATION_REQUIRED');self.assertTrue(failure['cloudStopped']);self.assertFalse((self.model/'READY.json').exists())

    def test_cached_verified_codec_is_reusable_offline_without_access_token(self):
        self.manifests['audar-tts-v1-flash']['files'][0]['gated']=True
        with patch.dict(os.environ,{},clear=True):
            result=prepare.prepare_models(self.packet('audar-tts-v1-flash',licenseAccepted=True,codecLicenseAccepted=True),model_dir=self.model,results_dir=self.root/'cached',engine_id=ENGINE_ID,account_id='account-one',downloader=lambda **kw:(_ for _ in ()).throw(AssertionError('NO_DOWNLOAD')),access_metadata=lambda *a,**k:(_ for _ in ()).throw(AssertionError('NO_NETWORK')))
        self.assertEqual(result['status'],'completed');self.assertTrue((self.model/'READY.json').is_file())

    def test_missing_codec_authorization_is_pinned_safe_and_not_retried(self):
        row=self.manifests['audar-tts-v1-flash']['files'][0];row['gated']=True
        (self.model/'model.bin').unlink()
        packet=self.packet('audar-tts-v1-flash',licenseAccepted=True,codecLicenseAccepted=True)
        receipt_root=self.root/'denied';calls=[]
        class Denied(Exception):
            response=types.SimpleNamespace(status_code=403)
        def metadata(url,**kw):
            calls.append((url,kw));raise Denied('sensitive URL/header must not be exposed')
        with patch.dict(os.environ,{'HF_TOKEN':'synthetic-token'},clear=True):
            result=prepare.prepare_models(packet,model_dir=self.model,results_dir=receipt_root,engine_id=ENGINE_ID,account_id='account-one',downloader=lambda **kw:(_ for _ in ()).throw(AssertionError('NO_DOWNLOAD')),access_metadata=metadata)
            saved=prepare.prepare_models(packet,model_dir=self.model,results_dir=receipt_root,engine_id=ENGINE_ID,account_id='account-one',access_metadata=lambda *a,**kw:(_ for _ in ()).throw(AssertionError('NO_RETRY')))
        self.assertEqual(saved,result);self.assertEqual(len(calls),1);self.assertIn(row['revision'],calls[0][0]);self.assertEqual(result['error'],'SPEECH_COMPONENT_ACCESS_DENIED');self.assertFalse(result['ready']);self.assertFalse((self.model/'READY.json').exists());self.assertNotIn('synthetic-token',json.dumps(result));self.assertNotIn('sensitive',json.dumps(result))


class FactoryTests(unittest.TestCase):
    def config(self,id='habibi-irq'):
        return {'modelId':id,'engineId':ENGINE_ID,'accountId':'account-one','modelVolume':'mashhad-speech-models','resultsVolume':'mashhad-speech-'+id+'-results-'+hashlib.sha256(ENGINE_ID.encode()).hexdigest()[:16],'weightPath':'models/'+id+'/'+ENGINE_ID,'gpu':'L40S','cpu':2,'ramGiB':16}

    def test_manifest_specialized_only_and_dependency_pins(self):
        for id in runtime.MODEL_IDS:
            m=runtime.manifest_for(id);self.assertEqual(m['totalBytes'],sum(f['size'] for f in m['files']));self.assertTrue(all(len(f['sha256'])==64 and len(f['revision'])==40 for f in m['files']))
            self.assertFalse(any('/Unified/' in f['path'] or '/SAU/' in f['path'] or '/UAE/' in f['path'] or f['path'].endswith('.gguf') for f in m['files']))
        lock=(runtime.ROOT/'requirements-gpu.lock').read_text();self.assertIn('torch==2.8.0+cu128',lock);self.assertNotIn('torch==2.9.',lock)

    def test_actual_modal_definitions_are_inert_all_four_scopes(self):
        from modal._utils.async_utils import synchronizer
        from modal.client import _Client
        with patch.object(_Client,'from_env',side_effect=AssertionError('NO_CLOUD')):
            for id in runtime.MODEL_IDS:
                app,cls=modal_app.build_speech_app(self.config(id));self.assertTrue(cls)
                self.assertEqual(set(app.registered_functions),{'prepare_models','SpeechEngine.*'})
                for f in app.registered_functions.values():self.assertFalse(synchronizer._translate_in(f)._get_source_info().is_serialized())

    def test_gpu_resource_bounds_and_cross_model_volume_rejected(self):
        for change in [{'gpu':'RTX-PRO-6000'},{'cpu':8},{'ramGiB':96},{'modelId':'other'},{'weightPath':'models/habibi-egy/'+ENGINE_ID},{'resultsVolume':'other'}]:
            with self.assertRaises(ValueError):modal_app.deployment_config({**self.config(),**change})

    def test_audar_authorization_hydrates_secret_before_any_volume_or_app_access(self):
        config=self.config('audar-tts-v1-flash');manifest=runtime.manifest_for(config['modelId'])
        packet={'definition':{'id':ENGINE_ID,'accountId':'account-one','modelId':config['modelId'],'volume':config['modelVolume'],'weightPath':config['weightPath'],'gpu':'L40S','cpu':2,'ramGiB':16},'scope':SCOPE,'paidApproved':True,'licenseAccepted':True,'codecLicenseAccepted':True,'manifestFingerprint':runtime.manifest_fingerprint(config['modelId']),'modelRevision':manifest['revision']}
        sdk=types.SimpleNamespace(Secret=types.SimpleNamespace(from_name=lambda *a,**kw:types.SimpleNamespace(hydrate=lambda:(_ for _ in ()).throw(RuntimeError('NO_AUTH')))))
        with self.assertRaisesRegex(RuntimeError,'SPEECH_CODEC_AUTHORIZATION_REQUIRED'):deploy.deploy_speech_app(packet,client=object(),sdk=sdk)

    def test_runtime_import_does_not_import_inference_packages(self):
        original=builtins.__import__
        def guarded(name,*args,**kwargs):
            if name.split('.')[0] in ('torch','torchaudio','transformers','habibi_tts','neucodec','audar_tts','numpy'):raise AssertionError('NO_INFERENCE_IMPORT')
            return original(name,*args,**kwargs)
        with patch('builtins.__import__',side_effect=guarded):
            import importlib
            importlib.reload(runtime)


class BackendContractTests(unittest.TestCase):
    def test_habibi_calls_official_specialized_model_local_vocos_and_no_asr(self):
        from speech import backends
        calls=[]
        def load(*args,**kwargs):calls.append(('model',args,kwargs));return object()
        def vocoder(*args,**kwargs):calls.append(('vocoder',args,kwargs));return object()
        def infer(*args,**kwargs):calls.append(('infer',args,kwargs));yield [0.1,0.2],24000
        tensor=types.SimpleNamespace(unsqueeze=lambda dim:object())
        fake_torch=types.SimpleNamespace(manual_seed=lambda seed:None,from_numpy=lambda value:tensor)
        modules={'torch':fake_torch,'numpy':types.SimpleNamespace(concatenate=lambda values:values[0]),'f5_tts.model':types.SimpleNamespace(DiT=object()),'f5_tts.infer.utils_infer':types.SimpleNamespace(load_model=load,load_vocoder=vocoder),'habibi_tts.infer.utils_infer':types.SimpleNamespace(infer_batch_process=infer)}
        with patch.dict(sys.modules,modules),patch.object(backends,'pcm_array',return_value=[0.1]),patch.object(backends,'pcm_bytes',return_value=b'\x01\x00'):
            backend=backends.HabibiBackend(Path('/models'),'habibi-irq','cpu');result=backend.synthesize(text='Hello',reference_audio=b'fixture',reference_transcript='Exact reference transcript',expression='neutral',seed=42)
        self.assertEqual(result,b'\x01\x00');self.assertIn('Specialized/IRQ/model_100000.safetensors',calls[0][1][2].replace('\\','/'));self.assertTrue(calls[1][2]['is_local'])
        args=calls[-1][2];self.assertEqual(args['nfe_step'],32);self.assertEqual(args['cfg_strength'],2.0);self.assertTrue(args['streaming']);self.assertIsNone(args['dialect_id']);self.assertIsNone(args['progress'])

    def test_audar_local_helpers_exact_expression_protocol_and_token_limit(self):
        from speech import backends
        calls=[]
        class Tokens:
            def __init__(self,ids):self.ids=ids
            def tolist(self):return self.ids
        class Output:
            def __getitem__(self,index):return Tokens([5,99])
        class IDs:
            shape=(1,3)
            def to(self,device):return self
        tok=types.SimpleNamespace(encode=lambda *a,**kw:IDs(),convert_tokens_to_ids=lambda value:99,decode=lambda *a,**kw:'<|speech_5|><|TARGET_CODES_END|>')
        def generate(*args,**kwargs):calls.append(('generate',kwargs));return Output()
        model=types.SimpleNamespace(device='cpu',generate=generate,eval=lambda:None)
        model.eval=lambda:model;model.to=lambda device:model
        class Loader:
            @staticmethod
            def from_pretrained(path,**kwargs):calls.append(('load',path,kwargs));return model
        class Tokenizer:
            @staticmethod
            def from_pretrained(path,**kwargs):calls.append(('tokenizer',path,kwargs));return tok
        class Context:
            def __enter__(self):return self
            def __exit__(self,*a):pass
        class Audio:
            def detach(self):return self
            def cpu(self):return self
            def numpy(self):return self
            def __getitem__(self,index):return [0.1]
        class Tensor:
            def __getitem__(self,index):return self
            def to(self,device):return self
        codec=types.SimpleNamespace(parameters=lambda:iter([types.SimpleNamespace(device='cpu')]),decode_code=lambda codes:Audio())
        def prompt(text,ref,codes):calls.append(('prompt',text,ref));return 'protocol'
        torch=types.SimpleNamespace(float32='fp32',manual_seed=lambda seed:None,no_grad=lambda:Context(),tensor=lambda data:Tensor())
        modules={'torch':torch,'transformers':types.SimpleNamespace(AutoTokenizer=Tokenizer,AutoModelForCausalLM=Loader),'audar_tts':types.SimpleNamespace(build_prompt=prompt,encode_reference=lambda *a:[1,2],GEN_DEFAULTS={'do_sample':True,'temperature':1.0,'top_k':40,'top_p':0.9,'repetition_penalty':1.1,'min_new_tokens':50})}
        with patch.dict(sys.modules,modules),patch.object(backends,'load_local_codec',return_value=codec),patch.object(backends,'pcm_array',return_value=[]),patch.object(backends,'pcm_bytes',return_value=b'\x01\x00'):
            backend=backends.AudarBackend(Path('/models'),'cpu');self.assertEqual(backend.synthesize(text='Exact words',reference_audio=b'x',reference_transcript='Reference',expression='whispers',seed=42),b'\x01\x00')
        self.assertTrue(calls[0][2]['local_files_only']);self.assertTrue(calls[1][2]['local_files_only']);self.assertEqual([v for v in calls if v[0]=='prompt'][0][1],'[whispers] Exact words');self.assertEqual(calls[-1][1]['max_new_tokens'],1500)


if __name__=='__main__':unittest.main()
