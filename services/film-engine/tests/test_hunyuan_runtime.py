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
from hunyuan import runtime,prepare,image,modal_app,deploy

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
    def request(self,**overrides):return {'prompt':'A fictional Iraqi courtyard at sunset.','width':720,'height':1280,'seed':42,'mode':'text_to_video','reference_images':[],'num_frames':121,'fps':24,**overrides}
    def fake_runtime(self):
        from contextlib import contextmanager
        self.calls=[];self.factory_calls=[]
        owner=self
        class Pipeline:
            target_size=960
            video_processor=types.SimpleNamespace(calculate_default_height_width=lambda **kw:(kw['height']-16,kw['width']) if kw['height']>kw['width'] else (kw['height'],kw['width']))
            @contextmanager
            def progress_bar(self,*a,**kw):yield types.SimpleNamespace(update=lambda n:None)
            def __call__(self,**kwargs):
                owner.calls.append(kwargs)
                with self.progress_bar(total=50) as bar:
                    for i in range(50):bar.update(1)
                w,h=(kwargs['image'].width,kwargs['image'].height-16 if kwargs['image'].height>kwargs['image'].width else kwargs['image'].height) if 'image' in kwargs else (kwargs['width'],kwargs['height'])
                return types.SimpleNamespace(frames=[[types.SimpleNamespace(width=w,height=h)]*kwargs['num_frames']])
        def factory(*args,**kwargs):self.factory_calls.append((args,kwargs));return Pipeline()
        def encoder(frames,file,fps):
            Path(file).write_bytes(b'\x00\x00\x00\x18ftypmp42'+b'SYNTHETIC-NOT-REAL-VIDEO')
            return {'width':frames[0].width,'height':frames[0].height,'numFrames':len(frames),'fps':fps,'durationMs':len(frames)/fps*1000,'audio':False}
        return runtime.HunyuanVideoRuntime(self.model,pipeline_factory=factory,image_loader=lambda data:types.SimpleNamespace(width=32,height=32),image_fitter=lambda image,size:types.SimpleNamespace(width=size[0],height=size[1],size=size),video_encoder=encoder,expected_scope={'engineId':ENGINE_ID,'accountId':'account-one'})

    def test_both_modes_all_four_variants_and_real_denoise_progress(self):
        engine=self.fake_runtime();progress=[]
        for index,(w,h,mode,variant) in enumerate([(848,480,'text_to_video','480p_t2v'),(480,832,'image_to_video','480p_i2v'),(1280,720,'text_to_video','720p_t2v'),(720,1264,'image_to_video','720p_i2v')]):
            result=engine.generate(self.request(width=w,height=h,mode=mode,reference_images=[PNG] if mode=='image_to_video' else []),self.root/str(index),progress.append)
            self.assertEqual(result['variant'],variant);self.assertEqual(self.factory_calls[-1][1]['variant'],variant)
            self.assertEqual(result['numFrames'],121);self.assertEqual(result['fps'],24);self.assertAlmostEqual(result['durationMs'],5041.6666667,places=4);self.assertFalse(result['audio']);self.assertEqual(result['steps'],50);self.assertEqual(result['guidanceScale'],6)
            self.assertEqual(result['referenceCount'],1 if mode=='image_to_video' else 0);self.assertNotIn('guidance_scale',self.calls[-1]);self.assertNotIn('callback_on_step_end',self.calls[-1])
        self.assertEqual(progress[:50],[{'completed':i,'total':50,'unit':'steps'} for i in range(1,51)])

    def test_same_variant_reuses_and_switch_does_not_keep_four_gpu_pipelines(self):
        engine=self.fake_runtime();engine.generate(self.request(),self.root/'a');engine.generate(self.request(seed=43),self.root/'b')
        self.assertEqual(len(self.factory_calls),1)
        engine.generate(self.request(mode='image_to_video',reference_images=[PNG],height=1264),self.root/'c');self.assertEqual(len(self.factory_calls),2)

    def test_invalid_temporal_reference_mode_dimensions_and_seed_rejected_before_load(self):
        engine=self.fake_runtime()
        for change in [{'seed':4294967296},{'seed':True},{'fps':16},{'fps':True},{'num_frames':125},{'num_frames':120},{'num_frames':1},{'width':721},{'mode':'image_to_video'},{'reference_images':[PNG]},{'mode':'image_to_video','reference_images':[PNG]*2},{'mode':'image_to_video','reference_images':['https://private.invalid/x']},{'enable_fp8':True}]:
            with self.assertRaises(ValueError):engine.generate(self.request(**change),self.root/'bad')
        self.assertEqual(self.factory_calls,[])

    def test_missing_model_wrong_scope_and_unapproved_license_never_download(self):
        engine=self.fake_runtime();(self.model/'READY.json').write_text(json.dumps({**self.marker,'accountId':'other'}))
        with self.assertRaisesRegex(RuntimeError,'HUNYUAN_WEIGHTS_NOT_READY'):engine.prepare()
        with self.assertRaisesRegex(ValueError,'HUNYUAN_LICENSE_ACCEPTANCE_REQUIRED'):prepare.prepare_models({**self.packet(),'licenseAccepted':False},model_dir=self.model,results_dir=self.root/'results',engine_id=ENGINE_ID,account_id='account-one')
        self.assertEqual(self.factory_calls,[])

    def test_no_overwrite_or_retry_and_callback_incomplete_is_not_success(self):
        engine=self.fake_runtime();engine.generate(self.request(),self.root/'out')
        with self.assertRaisesRegex(RuntimeError,'HUNYUAN_OUTPUT_ALREADY_EXISTS'):engine.generate(self.request(),self.root/'out')
        class Incomplete:
            def __init__(self,progress):self.progress_bar=progress
            def __call__(self,**kwargs):return types.SimpleNamespace(frames=[])
        engine.pipeline=Incomplete(engine.pipeline.progress_bar)
        with self.assertRaisesRegex(RuntimeError,'HUNYUAN_INCOMPLETE_PROGRESS'):engine.generate(self.request(),self.root/'incomplete')

    def test_native_i2v_bucket_must_match_before_inference_not_output_resize(self):
        engine=self.fake_runtime();engine.prepare('720p_i2v')
        engine.pipeline.video_processor=types.SimpleNamespace(calculate_default_height_width=lambda **kw:(1280,720))
        with self.assertRaisesRegex(RuntimeError,'HUNYUAN_CONDITIONING_BUCKET_MISMATCH'):engine.generate(self.request(mode='image_to_video',reference_images=[PNG],height=1264),self.root/'wrongbucket')
        self.assertEqual(self.calls,[])
        with self.assertRaises(ValueError):runtime.validate_request(self.request(mode='image_to_video',reference_images=[PNG],height=1280))

    def test_real_component_loader_contract_is_local_scoped_and_variant_specific(self):
        calls=[]
        def loader(name):
            class Component:
                @staticmethod
                def from_pretrained(path,**kwargs):
                    calls.append((name,path,kwargs))
                    if name=='HunyuanVideo15Transformer3DModel':return types.SimpleNamespace(config=types.SimpleNamespace(task_type='i2v' if 'i2v' in path else 't2v',target_size=640 if '480p' in path else 960))
                    if name=='ClassifierFreeGuidance':return types.SimpleNamespace(config=types.SimpleNamespace(guidance_scale=6))
                    if name=='AutoencoderKLHunyuanVideo15':return types.SimpleNamespace(enable_tiling=lambda:None)
                    return object()
            return Component
        class Pipeline:
            def __init__(self,**kwargs):self.transformer=kwargs['transformer'];self.target_size=self.transformer.config.target_size;self.vae=kwargs['vae'];self.guider=kwargs['guider']
            def enable_model_cpu_offload(self):calls.append(('offload',None,{}))
        modules={'diffusers':types.SimpleNamespace(HunyuanVideo15Pipeline=Pipeline,HunyuanVideo15ImageToVideoPipeline=Pipeline),'transformers':types.SimpleNamespace()}
        for variant in runtime.MANIFEST['variants'].values():
            for entry in variant['components'].values():setattr(modules[entry['library']],entry['className'],loader(entry['className']))
        modules['torch']=types.SimpleNamespace(bfloat16='bf16',cuda=types.SimpleNamespace(is_available=lambda:True,is_bf16_supported=lambda:True,empty_cache=lambda:None))
        with patch.dict(sys.modules,modules):
            engine=runtime.HunyuanVideoRuntime(self.model);engine.prepare('480p_t2v');engine.prepare('720p_i2v')
        self.assertTrue(all(call[2].get('local_files_only') is True for call in calls if call[0]!='offload'))
        transformers=[call for call in calls if call[0]=='HunyuanVideo15Transformer3DModel']
        self.assertEqual(len(transformers),2);self.assertIn('480p_t2v',transformers[0][1]);self.assertIn('720p_i2v',transformers[1][1]);self.assertEqual(transformers[0][2]['torch_dtype'],'bf16')

    def test_preparation_uses_per_source_pins_and_moves_only_verified_files_to_shared_path(self):
        missing='transformer/fixture.bin';(self.model/missing).unlink()
        for item in self.manifest['files']:
            if item['path']==missing:item.update(repoId='publisher/linked-model',revision='a'*40,sourcePath='original/weights.bin')
        calls=[]
        def downloader(**kwargs):
            calls.append(kwargs);file=Path(kwargs['local_dir'])/kwargs['filename'];file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(self.data[missing]);return file
        result=prepare.prepare_models(self.packet(),model_dir=self.model,results_dir=self.root/'mapped',engine_id=ENGINE_ID,account_id='account-one',downloader=downloader)
        self.assertEqual(result['status'],'completed');self.assertEqual(calls[0]['repo_id'],'publisher/linked-model');self.assertEqual(calls[0]['revision'],'a'*40);self.assertEqual(calls[0]['filename'],'original/weights.bin')
        self.assertEqual((self.model/missing).read_bytes(),self.data[missing])

    def packet(self):return {'paidApproved':True,'licenseAccepted':True,'scope':SCOPE,'modelRevision':runtime.MODEL_REVISION,'manifestFingerprint':runtime.manifest_fingerprint()}
    def test_unapproved_preparation_rejects_without_downloader_or_storage_mutation(self):
        before=(self.model/'READY.json').read_bytes()
        for packet in [{**self.packet(),'paidApproved':False},{**self.packet(),'manifestFingerprint':'wrong'},{**self.packet(),'scope':{**SCOPE,'accountId':'other'}}]:
            with patch.object(prepare,'sha256_file',side_effect=AssertionError('FORBIDDEN')):
                with self.assertRaises(ValueError):prepare.prepare_models(packet,model_dir=self.model,results_dir=self.root/'results',engine_id=ENGINE_ID,account_id='account-one')
        self.assertEqual((self.model/'READY.json').read_bytes(),before);self.assertFalse((self.root/'results').exists())

    def test_preparation_skips_verified_files_and_only_downloads_missing_pinned_file(self):
        missing='transformer/fixture.bin';(self.model/missing).unlink();calls=[]
        def download(**kwargs):calls.append(kwargs);file=Path(kwargs['local_dir'])/kwargs['filename'];file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(self.data[kwargs['filename']]);return file
        result=prepare.prepare_models(self.packet(),model_dir=self.model,results_dir=self.root/'results',engine_id=ENGINE_ID,account_id='account-one',downloader=download)
        self.assertEqual(result['status'],'completed');self.assertEqual(result['completedBytes'],self.manifest['totalBytes']);self.assertFalse(result['gpuUsed']);self.assertEqual([c['filename'] for c in calls],[missing]);self.assertEqual(calls[0]['revision'],runtime.MODEL_REVISION);self.assertFalse(calls[0]['token'])
        self.assertEqual(runtime.verify_local_model(self.model)['manifestFingerprint'],runtime.manifest_fingerprint())
        again=prepare.prepare_models(self.packet(),model_dir=self.model,results_dir=self.root/'results',engine_id=ENGINE_ID,account_id='account-one',downloader=lambda **k:(_ for _ in ()).throw(AssertionError('NO_RETRY')));self.assertEqual(again['status'],'completed')

    def test_failed_download_removes_readiness_and_is_not_retried_with_same_operation(self):
        (self.model/'transformer/fixture.bin').write_bytes(b'x'*len(self.data['transformer/fixture.bin']));calls=[]
        def fail(**kwargs):calls.append(kwargs);raise RuntimeError('never log secret details')
        with self.assertRaisesRegex(RuntimeError,'HUNYUAN_PREPARATION_FAILED'):prepare.prepare_models(self.packet(),model_dir=self.model,results_dir=self.root/'results',engine_id=ENGINE_ID,account_id='account-one',downloader=fail)
        self.assertFalse((self.model/'READY.json').exists())
        result=prepare.prepare_models(self.packet(),model_dir=self.model,results_dir=self.root/'results',engine_id=ENGINE_ID,account_id='account-one',downloader=fail)
        self.assertEqual(result['status'],'failed');self.assertEqual(len(calls),1);self.assertNotIn('secret',json.dumps(result))


class FactoryTests(unittest.TestCase):
    def config(self):return {'engineId':ENGINE_ID,'accountId':'account-one','modelVolume':'mashhad-models-account-one','resultsVolume':'mashhad-hunyuan-results-'+hashlib.sha256(ENGINE_ID.encode()).hexdigest()[:16],'weightPath':'models/hunyuanvideo15/'+ENGINE_ID,'gpu':'RTX-PRO-6000','cpu':4,'ramGiB':128}
    def test_pinned_manifest_excludes_duplicate_weights_and_doc_images(self):
        manifest=json.loads((runtime.ROOT/'model-manifest.json').read_text());self.assertEqual(manifest['revision'],'9b49404b3f5df2a8f0b31df27a0c7ab872e7b038');self.assertEqual(manifest['sourceCommit'],'60783e704160023913bee78f0b47036d393d4dfa');self.assertEqual(manifest['totalBytes'],sum(f['size'] for f in manifest['files']));self.assertEqual(manifest['totalBytes'],159203993734)
        names={f['path'] for f in manifest['files']};self.assertTrue(all(len(f['sha256'])==64 and len(f['revision'])==40 and f['repoId'] and f['sourcePath'] for f in manifest['files']))
        self.assertEqual(set(manifest['variants']),{'480p_t2v','480p_i2v','720p_t2v','720p_i2v'});self.assertEqual(manifest['license'],'tencent-hunyuan-community');self.assertTrue({'LICENSE','NOTICE'}<=names)
        self.assertTrue(all('distill' not in path and 'sr_' not in path and 'fp8' not in path for path in names))

    def test_scope_rejects_cross_account_engine_runtime_and_unsafe_request_ids(self):
        for change in [{'engineId':'other'},{'accountId':'other'},{'runId':'other'},{'requestId':'../escape'}]:
            with self.assertRaises(ValueError):runtime.validate_scope({**SCOPE,**change},ENGINE_ID,'account-one','run-one',request_required=True)

    def test_image_and_app_factories_register_real_sdk_objects_without_build_or_hydration(self):
        from modal._utils.async_utils import synchronizer
        from modal.client import _Client
        with patch.object(_Client,'from_env',side_effect=AssertionError('NO_CLOUD')):
            app,cls=modal_app.build_hunyuan_app(self.config())
        self.assertTrue(cls)
        self.assertEqual(set(app.registered_functions),{'prepare_models','HunyuanEngine.*'})
        for fn in app.registered_functions.values():self.assertFalse(synchronizer._translate_in(fn)._get_source_info().is_serialized())

    def test_deployment_is_bounded_and_cannot_select_third_gpu_or_share_results_volume(self):
        config=self.config();self.assertEqual(modal_app.deployment_config(config)['idleSeconds'],1200)
        for change in [{'gpu':'H100'},{'gpu':'L40S'},{'ramGiB':96},{'timeout':0},{'startupTimeout':9999},{'weightPath':'../escape'},{'resultsVolume':config['modelVolume']},{'engineId':'not-uuid'}]:
            with self.assertRaises(ValueError):modal_app.deployment_config({**config,**change})

    def test_approved_deploy_helper_never_contacts_sdk_without_matching_manifest_and_scope(self):
        packet={'definition':{'id':ENGINE_ID,'accountId':'account-one'},'scope':SCOPE,'paidApproved':False}
        with self.assertRaisesRegex(ValueError,'HUNYUAN_PREPARATION_APPROVAL_REQUIRED'):deploy.deploy_hunyuan_app(packet,client=object(),sdk=object())
        with self.assertRaisesRegex(ValueError,'HUNYUAN_MANIFEST_MISMATCH'):deploy.deploy_hunyuan_app({**packet,'paidApproved':True,'licenseAccepted':True},client=object(),sdk=object())

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
        packet={'definition':definition,'scope':SCOPE,'paidApproved':True,'licenseAccepted':True,'modelRevision':runtime.MODEL_REVISION,'manifestFingerprint':runtime.manifest_fingerprint()}
        with patch.object(deploy,'build_hunyuan_app',side_effect=AssertionError('NO_BUILD')):
            result=deploy.deploy_hunyuan_app(packet,client=object(),sdk=sdk);self.assertTrue(result['reused'])
            saved['accountId']='other-account'
            with self.assertRaisesRegex(RuntimeError,'HUNYUAN_DEPLOYMENT_OWNERSHIP_UNCONFIRMED'):deploy.deploy_hunyuan_app(packet,client=object(),sdk=sdk)

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
