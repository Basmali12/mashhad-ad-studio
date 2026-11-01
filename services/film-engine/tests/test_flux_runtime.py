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
from flux import runtime,prepare,image,modal_app,deploy

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
    def request(self,**overrides):return {'prompt':'A fictional Iraqi courtyard at sunset.','width':720,'height':1280,'seed':42,'mode':'text_to_image',**overrides}
    def fake_runtime(self):
        self.calls=[]
        class ResultImage:
            def __init__(self,w,h):self.width,self.height=w,h
            def save(self,file,format):assert format=='PNG';Path(file).write_bytes(PNG)
        def pipeline(**kwargs):
            self.calls.append(kwargs)
            for i in range(4):kwargs['callback_on_step_end'](None,i,None,{})
            return types.SimpleNamespace(images=[ResultImage(kwargs['width'],kwargs['height'])])
        self.factory_calls=[]
        def factory(*args,**kwargs):self.factory_calls.append((args,kwargs));return pipeline
        return runtime.FluxKleinRuntime(self.model,pipeline_factory=factory,image_loader=lambda data:('reference',hashlib.sha256(data).hexdigest()),expected_scope={'engineId':ENGINE_ID,'accountId':'account-one'})

    def test_unsigned_seed_boundary_matches_production_contract(self):
        engine=self.fake_runtime();engine.prepare()
        out=engine.generate(self.request(seed=4294967295),self.root/'seed-boundary')
        self.assertEqual(out['seed'],4294967295)
        with self.assertRaises(ValueError):engine.generate(self.request(seed=4294967296),self.root/'invalid-seed')

    def test_original_bf16_fixed_four_steps_and_dimensions_seed_metadata(self):
        engine=self.fake_runtime();progress=[];out=engine.generate(self.request(),self.root/'out',progress.append)
        self.assertEqual(out['width'],720);self.assertEqual(out['height'],1280);self.assertEqual(out['seed'],42)
        self.assertEqual(out['dtype'],'bfloat16');self.assertIsNone(out['quantization']);self.assertEqual(out['steps'],4);self.assertEqual(out['guidanceScale'],1.0)
        self.assertEqual(Path(out['imagePath']).read_bytes(),PNG);self.assertEqual(out['sha256'],hashlib.sha256(PNG).hexdigest());self.assertEqual(progress,[{'completed':i,'total':4,'unit':'steps'} for i in range(1,5)])
        self.assertTrue(self.factory_calls[0][1]['local_files_only']);self.assertEqual(self.factory_calls[0][1]['torch_dtype'],'bfloat16')

    def test_prepare_keeps_pipeline_loaded_for_later_images_without_reconstruction(self):
        engine=self.fake_runtime();engine.prepare();engine.generate(self.request(),self.root/'first');engine.generate(self.request(seed=43),self.root/'second');self.assertEqual(len(self.factory_calls),1);self.assertEqual(len(self.calls),2)

    def test_edit_and_multiple_references_reach_pipeline_without_flattening_or_external_fetch(self):
        engine=self.fake_runtime();engine.generate(self.request(mode='edit',reference_images=[PNG]),self.root/'single');self.assertEqual(self.calls[-1]['image'][0],'reference')
        engine.generate(self.request(mode='multi_reference',reference_images=[PNG,PNG+b'2']),self.root/'multi');self.assertEqual(len(self.calls[-1]['image']),2)

    def test_invalid_requests_fail_before_loading_weights_or_pipeline(self):
        engine=self.fake_runtime()
        for change in [{'width':721},{'height':0},{'seed':True},{'seed':-1},{'num_inference_steps':8},{'mode':'edit'},{'reference_images':['https://private.invalid/image.png']},{'mode':'multi_reference','reference_images':[PNG]},{'reference_images':[PNG]}]:
            with self.assertRaises(ValueError):engine.generate(self.request(**change),self.root/'bad')
        self.assertEqual(self.factory_calls,[])

    def test_incomplete_wrong_scope_or_wrong_revision_ready_marker_blocks_load(self):
        engine=self.fake_runtime()
        for change in [{'accountId':'other'},{'revision':'other'},{'manifestFingerprint':'0'*64},{'files':[]}]:
            (self.model/'READY.json').write_text(json.dumps({**self.marker,**change}),encoding='utf-8')
            with self.assertRaisesRegex(RuntimeError,'FLUX_WEIGHTS_NOT_READY'):engine.prepare()
        self.assertEqual(self.factory_calls,[])

    def test_missing_and_wrong_sized_files_never_download_on_gpu_load(self):
        engine=self.fake_runtime();(self.model/'transformer/fixture.bin').unlink()
        with self.assertRaisesRegex(RuntimeError,'FLUX_WEIGHTS_NOT_READY'):engine.prepare()
        self.assertEqual(self.factory_calls,[])

    def test_output_is_not_overwritten_and_pipeline_failure_does_not_retry(self):
        engine=self.fake_runtime();engine.generate(self.request(),self.root/'out')
        with self.assertRaisesRegex(RuntimeError,'FLUX_OUTPUT_ALREADY_EXISTS'):engine.generate(self.request(),self.root/'out')
        self.assertEqual(len(self.calls),1)
        def fail(**kwargs):raise RuntimeError('synthetic failure')
        engine.pipeline=fail
        with self.assertRaisesRegex(RuntimeError,'synthetic failure'):engine.generate(self.request(),self.root/'failed')
        self.assertFalse((self.root/'failed'/'image.png').exists())

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
        with self.assertRaisesRegex(RuntimeError,'FLUX_PREPARATION_FAILED'):prepare.prepare_models(self.packet(),model_dir=self.model,results_dir=self.root/'results',engine_id=ENGINE_ID,account_id='account-one',downloader=fail)
        self.assertFalse((self.model/'READY.json').exists())
        result=prepare.prepare_models(self.packet(),model_dir=self.model,results_dir=self.root/'results',engine_id=ENGINE_ID,account_id='account-one',downloader=fail)
        self.assertEqual(result['status'],'failed');self.assertEqual(len(calls),1);self.assertNotIn('secret',json.dumps(result))


class FactoryTests(unittest.TestCase):
    def config(self):return {'engineId':ENGINE_ID,'accountId':'account-one','modelVolume':'mashhad-models-account-one','resultsVolume':'mashhad-flux-results-'+hashlib.sha256(ENGINE_ID.encode()).hexdigest()[:16],'weightPath':'models/flux2-klein-4b/'+ENGINE_ID,'gpu':'RTX-PRO-6000','cpu':4,'ramGiB':96}
    def test_pinned_manifest_excludes_duplicate_weights_and_doc_images(self):
        manifest=json.loads((runtime.ROOT/'model-manifest.json').read_text());self.assertEqual(manifest['revision'],'e7b7dc27f91deacad38e78976d1f2b499d76a294');self.assertEqual(manifest['sourceCommit'],'50fe5162777813d869182b139e83b10743caef15');self.assertEqual(manifest['totalBytes'],sum(f['size'] for f in manifest['files']));self.assertEqual(manifest['totalBytes'],15975692643)
        names={f['path'] for f in manifest['files']};self.assertNotIn('flux-2-klein-4b.safetensors',names);self.assertTrue({'tokenizer/tokenizer.json','transformer/diffusion_pytorch_model.safetensors','LICENSE.md'}<=names);self.assertTrue(all(len(f['sha256'])==64 for f in manifest['files']))

    def test_scope_rejects_cross_account_engine_runtime_and_unsafe_request_ids(self):
        for change in [{'engineId':'other'},{'accountId':'other'},{'runId':'other'},{'requestId':'../escape'}]:
            with self.assertRaises(ValueError):runtime.validate_scope({**SCOPE,**change},ENGINE_ID,'account-one','run-one',request_required=True)

    def test_image_and_app_factories_register_real_sdk_objects_without_build_or_hydration(self):
        from modal._utils.async_utils import synchronizer
        from modal.client import _Client
        with patch.object(_Client,'from_env',side_effect=AssertionError('NO_CLOUD')):
            app,cls=modal_app.build_flux_app(self.config())
        self.assertTrue(cls)
        self.assertEqual(set(app.registered_functions),{'prepare_models','KleinEngine.*'})
        for fn in app.registered_functions.values():self.assertFalse(synchronizer._translate_in(fn)._get_source_info().is_serialized())

    def test_deployment_is_bounded_and_cannot_select_third_gpu_or_share_results_volume(self):
        config=self.config();self.assertEqual(modal_app.deployment_config(config)['idleSeconds'],1200)
        for change in [{'gpu':'H100'},{'timeout':0},{'startupTimeout':9999},{'weightPath':'../escape'},{'resultsVolume':config['modelVolume']},{'engineId':'not-uuid'}]:
            with self.assertRaises(ValueError):modal_app.deployment_config({**config,**change})

    def test_approved_deploy_helper_never_contacts_sdk_without_matching_manifest_and_scope(self):
        packet={'definition':{'id':ENGINE_ID,'accountId':'account-one'},'scope':SCOPE,'paidApproved':False}
        with self.assertRaisesRegex(ValueError,'FLUX_PREPARATION_APPROVAL_REQUIRED'):deploy.deploy_flux_app(packet,client=object(),sdk=object())
        with self.assertRaisesRegex(ValueError,'FLUX_MANIFEST_MISMATCH'):deploy.deploy_flux_app({**packet,'paidApproved':True},client=object(),sdk=object())

    def test_existing_attested_deployment_reuses_without_build_and_unknown_ownership_is_rejected(self):
        config=modal_app.deployment_config(self.config())
        saved={**config,'appId':'ap-synthetic','classId':'cs-synthetic','manifestFingerprint':runtime.manifest_fingerprint(),'bundleFingerprint':deploy.bundle_fingerprint()}
        class Volume:
            def read_file(self,name):
                self_outer.assertEqual(name,'deployment.json')
                yield json.dumps(saved).encode()
        self_outer=self
        sdk=types.SimpleNamespace(App=types.SimpleNamespace(lookup=lambda *a,**k:types.SimpleNamespace(app_id='ap-synthetic')),Volume=types.SimpleNamespace(from_name=lambda *a,**k:Volume()),Cls=types.SimpleNamespace(from_name=lambda *a,**k:types.SimpleNamespace(hydrate=lambda:None,object_id='cs-synthetic')),exception=types.SimpleNamespace(NotFoundError=FileNotFoundError))
        definition={'id':ENGINE_ID,'accountId':'account-one','volume':config['modelVolume'],'weightPath':config['weightPath'],'gpu':config['gpu'],'cpu':4,'ramGiB':96}
        packet={'definition':definition,'scope':SCOPE,'paidApproved':True,'modelRevision':runtime.MODEL_REVISION,'manifestFingerprint':runtime.manifest_fingerprint()}
        with patch.object(deploy,'build_flux_app',side_effect=AssertionError('NO_BUILD')):
            result=deploy.deploy_flux_app(packet,client=object(),sdk=sdk);self.assertTrue(result['reused'])
            saved['accountId']='other-account'
            with self.assertRaisesRegex(RuntimeError,'FLUX_DEPLOYMENT_OWNERSHIP_UNCONFIRMED'):deploy.deploy_flux_app(packet,client=object(),sdk=sdk)

    def test_image_layers_have_no_definition_job_seed_or_prompt_and_cpu_has_no_torch(self):
        class Image:
            def __init__(self):self.calls=[]
            @classmethod
            def debian_slim(cls,**kwargs):value=cls();value.calls.append(('base',kwargs));return value
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
