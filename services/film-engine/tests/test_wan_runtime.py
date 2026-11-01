"""Offline synthetic fixtures only: no weights, SDK hydration, downloads or GPU."""
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

ENGINE=Path(__file__).resolve().parents[1]/'engine'
sys.path.insert(0,str(ENGINE))
from wan import runtime,prepare,image,modal_app,deploy

PNG=b'\x89PNG\r\n\x1a\n'+b'SYNTHETIC-ONLY-NOT-A-GENERATED-IMAGE'
ENGINE_ID='12345678-1234-1234-1234-123456789abc'
SCOPE={'engineId':ENGINE_ID,'accountId':'account-one','runId':'run-one','requestId':'request-one'}


class Fixture(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory();self.addCleanup(self.temporary.cleanup)
        self.root=Path(self.temporary.name);self.model=self.root/'models';self.model.mkdir()
        self.data={'transformer/fixture.bin':b'not-real-model-a','tokenizer/fixture.json':b'{}'}
        self.manifest={**runtime.MANIFEST,'files':[{'path':name,'size':len(value),'sha256':hashlib.sha256(value).hexdigest()} for name,value in self.data.items()],'totalBytes':sum(map(len,self.data.values()))}
        self.addCleanup(patch.stopall);patch.object(runtime,'MANIFEST',self.manifest).start();patch.object(prepare,'MANIFEST',self.manifest).start()
        for name,value in self.data.items():file=self.model/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(value)
        self.marker={'modelId':runtime.MODEL_ID,'revision':runtime.MODEL_REVISION,'manifestFingerprint':runtime.manifest_fingerprint(),'engineId':ENGINE_ID,'accountId':'account-one','files':self.manifest['files']}
        (self.model/'READY.json').write_text(json.dumps(self.marker),encoding='utf-8')
    def request(self,**overrides):return {'prompt':'An Iraqi courtyard at sunset.','width':720,'height':1280,'seed':42,'mode':'image_to_video','reference_images':[PNG],'num_frames':81,'fps':16,**overrides}
    def fake_runtime(self):
        self.calls=[];self.factory_calls=[]
        def pipeline(**kwargs):
            self.calls.append(kwargs)
            for i in range(40):kwargs['callback_on_step_end'](None,i,None,{})
            frame=types.SimpleNamespace(width=kwargs['width'],height=kwargs['height'])
            return types.SimpleNamespace(frames=[[frame]*kwargs['num_frames']])
        def factory(*args,**kwargs):self.factory_calls.append((args,kwargs));return pipeline
        def encoder(frames,file,fps):
            Path(file).write_bytes(b'\x00\x00\x00\x18ftypmp42'+b'SYNTHETIC-NOT-REAL-VIDEO')
            return {'width':frames[0].width,'height':frames[0].height,'numFrames':len(frames),'fps':fps,'durationMs':len(frames)/fps*1000,'audio':False}
        return runtime.WanVideoRuntime(self.model,pipeline_factory=factory,image_loader=lambda data:('reference',hashlib.sha256(data).hexdigest()),video_encoder=encoder,expected_scope={'engineId':ENGINE_ID,'accountId':'account-one'})

    def test_fixed_original_two_expert_guidance_and_actual_progress(self):
        engine=self.fake_runtime();progress=[];out=engine.generate(self.request(),self.root/'out',progress.append)
        self.assertEqual(out['numFrames'],81);self.assertEqual(out['fps'],16);self.assertEqual(out['durationMs'],5062.5);self.assertFalse(out['audio'])
        self.assertEqual(out['dtype'],'bfloat16');self.assertIsNone(out['quantization']);self.assertEqual(out['steps'],40);self.assertEqual(out['guidanceScale'],3.5);self.assertEqual(out['guidanceScale2'],3.5)
        self.assertEqual(self.calls[0]['guidance_scale_2'],3.5);self.assertEqual(self.calls[0]['output_type'],'pil')
        self.assertEqual(progress,[{'completed':i,'total':40,'unit':'steps'} for i in range(1,41)]);self.assertEqual(Path(out['videoPath']).read_bytes()[4:8],b'ftyp')
        self.assertTrue(self.factory_calls[0][1]['local_files_only']);self.assertEqual(self.factory_calls[0][1]['torch_dtype'],'bfloat16')
        self.assertEqual(out['attentionBackendPolicy'],'pytorch_native_sdpa_auto')

    def test_no_forced_quadratic_math_backend_or_unverified_flash_extension(self):
        source=(runtime.ROOT/'runtime.py').read_text();lock=(runtime.ROOT/'requirements-gpu.lock').read_text()
        self.assertNotIn('sdpa_kernel(',source);self.assertNotIn('SDPBackend.MATH',source)
        self.assertNotIn('flash_attn==',lock);self.assertNotIn('flash-attn==',lock)

    def test_all_native_dimensions_short_clip_and_maximum_seed(self):
        engine=self.fake_runtime()
        for index,(w,h) in enumerate([(480,832),(832,480),(720,1280),(1280,720)]):
            result=engine.generate(self.request(width=w,height=h,num_frames=5,seed=4294967295),self.root/str(index))
            self.assertEqual((result['width'],result['height']),(w,h));self.assertEqual(result['numFrames'],5)
        self.assertEqual(len(self.factory_calls),1)

    def test_invalid_request_rejects_before_load(self):
        engine=self.fake_runtime()
        for change in [{'width':721},{'height':0},{'seed':True},{'seed':-1},{'seed':4294967296},{'num_inference_steps':8},{'mode':'text_to_video'},{'reference_images':[]},{'reference_images':[PNG]*2},{'reference_images':['https://private.invalid/x']},{'num_frames':80},{'num_frames':85},{'num_frames':1},{'fps':24},{'fps':True}]:
            with self.assertRaises(ValueError):engine.generate(self.request(**change),self.root/'bad')
        self.assertEqual(self.factory_calls,[])

    def test_dimension_framecount_and_encoding_drift_are_errors(self):
        engine=self.fake_runtime();engine.prepare()
        for mode,expected in [('dims','DIMENSIONS'),('count','FRAME_COUNT')]:
            def pipeline(**kwargs):
                for i in range(40):kwargs['callback_on_step_end'](None,i,None,{})
                return types.SimpleNamespace(frames=[[types.SimpleNamespace(width=704 if mode=='dims' else 720,height=1280)]*(80 if mode=='count' else 81)])
            engine.pipeline=pipeline
            with self.assertRaisesRegex(RuntimeError,'WAN_OUTPUT_'+expected+'_CHANGED'):engine.generate(self.request(),self.root/mode)
        engine=self.fake_runtime()
        def bad_encoder(frames,path,fps):return {'audio':True}
        engine.video_encoder=bad_encoder
        with self.assertRaisesRegex(RuntimeError,'WAN_ENCODED_VIDEO_MISMATCH'):engine.generate(self.request(),self.root/'badencoding')

    def test_missing_model_and_scoped_marker_never_download(self):
        engine=self.fake_runtime()
        (self.model/'READY.json').write_text(json.dumps({**self.marker,'accountId':'other'}))
        with self.assertRaisesRegex(RuntimeError,'WAN_WEIGHTS_NOT_READY'):engine.prepare()
        self.assertEqual(self.factory_calls,[])

    def test_output_no_overwrite_and_failed_inference_not_retried(self):
        engine=self.fake_runtime();engine.generate(self.request(),self.root/'out')
        with self.assertRaisesRegex(RuntimeError,'WAN_OUTPUT_ALREADY_EXISTS'):engine.generate(self.request(),self.root/'out')
        self.assertEqual(len(self.calls),1)
        engine.pipeline=lambda **k:(_ for _ in ()).throw(RuntimeError('synthetic failure'))
        with self.assertRaisesRegex(RuntimeError,'synthetic failure'):engine.generate(self.request(),self.root/'failed')

    def test_actual_loader_uses_both_local_experts_bf16_fp32_vae_and_offload(self):
        calls=[]
        pipeline=types.SimpleNamespace(transformer=object(),transformer_2=object(),config=types.SimpleNamespace(boundary_ratio=0.9),enable_model_cpu_offload=lambda:calls.append(('offload',)))
        class Pipeline:
            @staticmethod
            def from_pretrained(*args,**kwargs):calls.append(('pipeline',args,kwargs));return pipeline
        class VAE:
            @staticmethod
            def from_pretrained(*args,**kwargs):calls.append(('vae',args,kwargs));return 'original-vae'
        torch=types.SimpleNamespace(bfloat16='bf16',float32='fp32',cuda=types.SimpleNamespace(is_available=lambda:True,is_bf16_supported=lambda:True))
        with patch.dict(sys.modules,{'torch':torch,'diffusers':types.SimpleNamespace(WanImageToVideoPipeline=Pipeline,AutoencoderKLWan=VAE)}):
            engine=runtime.WanVideoRuntime(self.model);self.assertTrue(engine.prepare()['ready'])
        self.assertTrue(calls[0][2]['local_files_only']);self.assertEqual(calls[0][2]['torch_dtype'],'fp32')
        self.assertTrue(calls[1][2]['local_files_only']);self.assertEqual(calls[1][2]['torch_dtype'],'bf16');self.assertEqual(calls[-1],('offload',))
        pipeline.transformer_2=None
        with patch.dict(sys.modules,{'torch':torch,'diffusers':types.SimpleNamespace(WanImageToVideoPipeline=Pipeline,AutoencoderKLWan=VAE)}):
            with self.assertRaisesRegex(RuntimeError,'WAN_EXPERT_CONFIGURATION_MISMATCH'):runtime.WanVideoRuntime(self.model).prepare()

    def test_encoder_streams_native_frames_silent_and_probes_actual_output(self):
        import subprocess
        writes=[]
        process=types.SimpleNamespace(stdin=types.SimpleNamespace(write=lambda data:writes.append(data),close=lambda:None),
                                      stderr=types.SimpleNamespace(close=lambda:None),wait=lambda **k:0,kill=lambda:None)
        frame=types.SimpleNamespace(size=(16,16),convert=lambda mode:types.SimpleNamespace(tobytes=lambda:b'x'*768))
        probe={'streams':[{'codec_type':'video','width':16,'height':16,'nb_read_frames':'5','avg_frame_rate':'16/1'}],'format':{'duration':'0.312500'}}
        with patch.object(subprocess,'Popen',return_value=process) as popen,patch.object(subprocess,'run',return_value=types.SimpleNamespace(stdout=json.dumps(probe).encode())):
            result=runtime.encode_video([frame]*5,self.root/'native.mp4',16)
        command=popen.call_args.args[0];self.assertIn('-an',command);self.assertIn('-n',command);self.assertNotIn('-vf',command)
        self.assertEqual(len(writes),5);self.assertEqual(result['durationMs'],312.5);self.assertFalse(result['audio'])

    def test_incomplete_progress_and_oversize_encoder_output_rejected(self):
        engine=self.fake_runtime();engine.prepare();original=engine.pipeline
        def incomplete(**kwargs):
            callback=kwargs['callback_on_step_end'];kwargs['callback_on_step_end']=lambda *a: a[-1]
            result=original(**kwargs);callback(None,0,None,{})
            return result
        engine.pipeline=incomplete
        with self.assertRaisesRegex(RuntimeError,'WAN_INCOMPLETE_PROGRESS'):engine.generate(self.request(),self.root/'incomplete')
        engine=self.fake_runtime();encoder=engine.video_encoder
        def oversize(frames,path,fps):
            info=encoder(frames,path,fps)
            with Path(path).open('ab') as stream:stream.truncate(runtime.MAX_VIDEO_BYTES+1)
            return info
        engine.video_encoder=oversize
        with self.assertRaisesRegex(RuntimeError,'WAN_INVALID_OUTPUT'):engine.generate(self.request(),self.root/'oversize')

    def packet(self):return {'paidApproved':True,'scope':SCOPE,'modelRevision':runtime.MODEL_REVISION,'manifestFingerprint':runtime.manifest_fingerprint()}
    def test_unapproved_preparation_rejects_without_downloader_or_storage_mutation(self):
        before=(self.model/'READY.json').read_bytes()
        for packet in [{**self.packet(),'paidApproved':False},{**self.packet(),'manifestFingerprint':'wrong'},{**self.packet(),'scope':{**SCOPE,'accountId':'other'}}]:
            with patch.object(prepare,'sha256_file',side_effect=AssertionError('FORBIDDEN')):
                with self.assertRaises(ValueError):prepare.prepare_models(packet,model_dir=self.model,results_dir=self.root/'results',engine_id=ENGINE_ID,account_id='account-one')
        self.assertEqual((self.model/'READY.json').read_bytes(),before);self.assertFalse((self.root/'results').exists())

    def test_preparation_skips_verified_files_and_only_downloads_missing_pinned_file(self):
        missing='transformer/fixture.bin';(self.model/missing).unlink();calls=[]
        def download(**kwargs):calls.append(kwargs);file=self.model/kwargs['filename'];file.write_bytes(self.data[kwargs['filename']]);return file
        result=prepare.prepare_models(self.packet(),model_dir=self.model,results_dir=self.root/'results',engine_id=ENGINE_ID,account_id='account-one',downloader=download)
        self.assertEqual(result['status'],'completed');self.assertEqual(result['completedBytes'],self.manifest['totalBytes']);self.assertFalse(result['gpuUsed']);self.assertEqual([c['filename'] for c in calls],[missing]);self.assertEqual(calls[0]['revision'],runtime.MODEL_REVISION);self.assertFalse(calls[0]['token'])
        self.assertEqual(runtime.verify_local_model(self.model)['manifestFingerprint'],runtime.manifest_fingerprint())
        again=prepare.prepare_models(self.packet(),model_dir=self.model,results_dir=self.root/'results',engine_id=ENGINE_ID,account_id='account-one',downloader=lambda **k:(_ for _ in ()).throw(AssertionError('NO_RETRY')));self.assertEqual(again['status'],'completed')

    def test_failed_download_removes_readiness_and_is_not_retried_with_same_operation(self):
        (self.model/'transformer/fixture.bin').write_bytes(b'x'*len(self.data['transformer/fixture.bin']));calls=[]
        def fail(**kwargs):calls.append(kwargs);raise RuntimeError('never log secret details')
        with self.assertRaisesRegex(RuntimeError,'WAN_PREPARATION_FAILED'):prepare.prepare_models(self.packet(),model_dir=self.model,results_dir=self.root/'results',engine_id=ENGINE_ID,account_id='account-one',downloader=fail)
        self.assertFalse((self.model/'READY.json').exists())
        result=prepare.prepare_models(self.packet(),model_dir=self.model,results_dir=self.root/'results',engine_id=ENGINE_ID,account_id='account-one',downloader=fail)
        self.assertEqual(result['status'],'failed');self.assertEqual(len(calls),1);self.assertNotIn('secret',json.dumps(result))


class FactoryTests(unittest.TestCase):
    def config(self):return {'engineId':ENGINE_ID,'accountId':'account-one','modelVolume':'mashhad-models-account-one','resultsVolume':'mashhad-wan-results-'+hashlib.sha256(ENGINE_ID.encode()).hexdigest()[:16],'weightPath':'models/wan22-i2v-a14b/'+ENGINE_ID,'gpu':'RTX-PRO-6000','cpu':4,'ramGiB':128}
    def test_pinned_manifest_excludes_duplicate_weights_and_doc_images(self):
        manifest=json.loads((runtime.ROOT/'model-manifest.json').read_text());self.assertEqual(manifest['revision'],'596658fd9ca6b7b71d5057529bbf319ecbc61d74');self.assertEqual(manifest['sourceCommit'],'1ea34ff48f87168174e12956e200b1d908b1c5ff');self.assertEqual(manifest['totalBytes'],sum(f['size'] for f in manifest['files']));self.assertEqual(manifest['totalBytes'],126202569662)
        names={f['path'] for f in manifest['files']};self.assertTrue(all(not f['path'].endswith('.safetensors') or f['verificationSource']=='publisher-lfs-sha256-metadata' for f in manifest['files']));self.assertTrue({'tokenizer/tokenizer.json','transformer/diffusion_pytorch_model-00001-of-00012.safetensors','transformer_2/diffusion_pytorch_model-00001-of-00012.safetensors','README.md'}<=names);self.assertTrue(all(len(f['sha256'])==64 for f in manifest['files']))

    def test_scope_rejects_cross_account_engine_runtime_and_unsafe_request_ids(self):
        for change in [{'engineId':'other'},{'accountId':'other'},{'runId':'other'},{'requestId':'../escape'}]:
            with self.assertRaises(ValueError):runtime.validate_scope({**SCOPE,**change},ENGINE_ID,'account-one','run-one',request_required=True)

    def test_image_and_app_factories_register_real_sdk_objects_without_build_or_hydration(self):
        from modal._utils.async_utils import synchronizer
        from modal.client import _Client
        with patch.object(_Client,'from_env',side_effect=AssertionError('NO_CLOUD')):
            app,cls=modal_app.build_wan_app(self.config())
        self.assertTrue(cls)
        self.assertEqual(set(app.registered_functions),{'prepare_models','WanEngine.*'})
        for fn in app.registered_functions.values():self.assertFalse(synchronizer._translate_in(fn)._get_source_info().is_serialized())

    def test_deployment_is_bounded_and_cannot_select_third_gpu_or_share_results_volume(self):
        config=self.config();self.assertEqual(modal_app.deployment_config(config)['idleSeconds'],1200)
        for change in [{'gpu':'H100'},{'gpu':'L40S'},{'ramGiB':96},{'timeout':0},{'startupTimeout':9999},{'weightPath':'../escape'},{'resultsVolume':config['modelVolume']},{'engineId':'not-uuid'}]:
            with self.assertRaises(ValueError):modal_app.deployment_config({**config,**change})

    def test_approved_deploy_helper_never_contacts_sdk_without_matching_manifest_and_scope(self):
        packet={'definition':{'id':ENGINE_ID,'accountId':'account-one'},'scope':SCOPE,'paidApproved':False}
        with self.assertRaisesRegex(ValueError,'WAN_PREPARATION_APPROVAL_REQUIRED'):deploy.deploy_wan_app(packet,client=object(),sdk=object())
        with self.assertRaisesRegex(ValueError,'WAN_MANIFEST_MISMATCH'):deploy.deploy_wan_app({**packet,'paidApproved':True},client=object(),sdk=object())

    def test_existing_attested_deployment_reuses_without_build_and_unknown_ownership_is_rejected(self):
        config=modal_app.deployment_config(self.config())
        saved={**config,'appId':'ap-synthetic','classId':'cs-synthetic','manifestFingerprint':runtime.manifest_fingerprint(),'bundleFingerprint':deploy.bundle_fingerprint()}
        class Volume:
            def read_file(self,name):
                self_outer.assertEqual(name,'deployment.json')
                yield json.dumps(saved).encode()
        self_outer=self
        sdk=types.SimpleNamespace(App=types.SimpleNamespace(lookup=lambda *a,**k:types.SimpleNamespace(app_id='ap-synthetic')),Volume=types.SimpleNamespace(from_name=lambda *a,**k:Volume()),Cls=types.SimpleNamespace(from_name=lambda *a,**k:types.SimpleNamespace(hydrate=lambda:None,object_id='cs-synthetic')),exception=types.SimpleNamespace(NotFoundError=FileNotFoundError))
        definition={'id':ENGINE_ID,'accountId':'account-one','volume':config['modelVolume'],'weightPath':config['weightPath'],'gpu':config['gpu'],'cpu':4,'ramGiB':128}
        packet={'definition':definition,'scope':SCOPE,'paidApproved':True,'modelRevision':runtime.MODEL_REVISION,'manifestFingerprint':runtime.manifest_fingerprint()}
        with patch.object(deploy,'build_wan_app',side_effect=AssertionError('NO_BUILD')):
            result=deploy.deploy_wan_app(packet,client=object(),sdk=sdk);self.assertTrue(result['reused'])
            saved['accountId']='other-account'
            with self.assertRaisesRegex(RuntimeError,'WAN_DEPLOYMENT_OWNERSHIP_UNCONFIRMED'):deploy.deploy_wan_app(packet,client=object(),sdk=sdk)

    def test_image_layers_have_no_definition_job_seed_or_prompt_and_cpu_has_no_torch(self):
        class Image:
            def __init__(self):self.calls=[]
            @classmethod
            def debian_slim(cls,**kwargs):value=cls();value.calls.append(('base',kwargs));return value
            def apt_install(self,*values):self.calls.append(('apt',values));return self
            def pip_install_from_requirements(self,file):self.calls.append(('requirements',Path(file).name));return self
            def env(self,values):self.calls.append(('env',values));return self
            def add_local_dir(self,*args,**kwargs):self.calls.append(('source',str(args[0]),args[1],kwargs));return self
        sdk=types.SimpleNamespace(Image=Image)
        first=image.build_model_image(sdk).calls;second=image.build_model_image(sdk).calls;self.assertEqual(first,second)
        data=json.dumps(first);self.assertNotIn(ENGINE_ID,data);self.assertNotIn('run-one',data);self.assertNotIn('prompt',data);self.assertNotIn('tokenSecret',data)
        cpu=(runtime.ROOT/'requirements-cpu.lock').read_text();self.assertNotIn('torch==',cpu);self.assertNotIn('diffusers==',cpu)

    def test_runtime_module_import_has_no_inference_imports(self):
        original=builtins.__import__
        def restricted(name,*args,**kwargs):
            if name.split('.')[0] in ('torch','diffusers','transformers','huggingface_hub'):raise AssertionError('NO_INFERENCE_IMPORT')
            return original(name,*args,**kwargs)
        with patch('builtins.__import__',side_effect=restricted):
            import importlib
            importlib.reload(runtime)


if __name__=='__main__':unittest.main()
