"""Offline native boundary tests: no SDK RPC, GPU, weights or installed kernels."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'engine'))
from wan import lightwan_runtime as r, lightwan_prepare as prep
from wan import lightwan_modal as cloud


class LightWanTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.model, self.work = self.root / 'isolated', self.root / 'work'
        self.m = copy.deepcopy(r.manifest())
        for f in self.m['files']:
            f['size'], f['sha256'] = 1, hashlib.sha256(b'x').hexdigest()
        self.m['totalBytes'] = len(self.m['files'])
        self.scope = {'engineId': '12345678-1234-1234-1234-123456789abc', 'accountId': 'primary'}
        self.addCleanup(patch.stopall)
        patch.object(r, 'manifest', return_value=self.m).start()
        patch.object(prep, 'manifest', return_value=self.m).start()
        self.calls = []

    def approve(self):
        def download(**k):
            self.calls.append(k)
            target = Path(k['local_dir']) / k['filename']
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b'x')
            return target
        return prep.prepare_lightwan({'paidApproved': True, 'manifestFingerprint': r.fingerprint(self.m),
                                      'scope': {**self.scope, 'runId': 'run', 'requestId': 'prepare'}},
                                     self.model, engine_id=self.scope['engineId'], account_id='primary', downloader=download)

    def request(self):
        return {'mode': 'image_to_video', 'prompt': 'Exact original camera and character prompt',
                'width': 720, 'height': 1280, 'seed': 42, 'num_frames': 81,
                'fps': 16, 'reference_images': [b'\x89PNG\r\n\x1a\n' + b'original-reference-bytes']}

    def test_preparation_needs_exact_consent_before_downloader_or_directories(self):
        with self.assertRaisesRegex(ValueError, 'APPROVAL_REQUIRED'):
            prep.prepare_lightwan({}, self.model, engine_id='x', account_id='y', downloader=lambda **k: self.fail())
        self.assertFalse(self.model.exists())

    def test_preparation_pins_native_components_and_reuses_valid_files(self):
        proof = self.approve()
        self.assertEqual(len(self.calls), 10)
        self.assertFalse(proof['gpuUsed'])
        self.assertTrue(all(c['token'] is False and len(c['revision']) == 40 for c in self.calls))
        self.calls.clear()
        self.approve()
        self.assertFalse(self.calls)
        self.assertEqual(r.verify_ready(self.model, self.scope), self.m)
        self.assertFalse((self.model / 'READY.json').exists())

    def test_failed_reverification_invalidates_only_accelerated_readiness(self):
        self.approve()
        original = self.model / 'READY.json'
        original.write_text('original-profile-untouched')
        (self.model / self.m['files'][0]['path']).write_bytes(b'y')
        with self.assertRaisesRegex(RuntimeError, 'INTEGRITY_FAILED'):
            self.approve()
        self.assertFalse((self.model / 'LIGHTWAN_READY.json').exists())
        self.assertEqual(original.read_text(), 'original-profile-untouched')
        with self.assertRaisesRegex(RuntimeError, 'NOT_READY'):
            r.verify_ready(self.model, self.scope)

    def test_missing_or_different_component_blocks_before_runtime_loading(self):
        with self.assertRaisesRegex(RuntimeError, 'NOT_READY'):
            r.LightWanRuntime(self.model, self.work, expected_scope=self.scope, stack_probe=lambda m: self.fail()).prepare()
        self.approve()
        (self.model / self.m['files'][0]['path']).unlink()
        with self.assertRaisesRegex(RuntimeError, 'NOT_READY'):
            r.LightWanRuntime(self.model, self.work, expected_scope=self.scope, stack_probe=lambda m: self.fail()).prepare()
        with self.assertRaisesRegex(RuntimeError, 'NOT_READY'):
            r.verify_ready(self.model, {**self.scope, 'accountId': 'other'})

    def test_pinned_four_step_schedule_is_not_original_with_fewer_steps(self):
        config = r.native_config(self.model, 720, 1280, self.m)
        self.assertEqual(config['size'], [1280, 720])
        self.assertEqual(config['num_frames'], 81)
        self.assertEqual(config['denoising_step_list'], [1000, 750, 500, 250])
        self.assertEqual(config['boundary_step_index'], 2)
        self.assertEqual(config['infer_steps'], 4)
        self.assertFalse(config['enable_cfg'])
        self.assertEqual(config['dit_quant_scheme'], 'nvfp4')
        self.assertNotEqual(config['high_noise_quantized_ckpt'], config['low_noise_quantized_ckpt'])
        self.assertFalse(config['use_image_encoder'])
        with self.assertRaisesRegex(ValueError, '720P'):
            r.native_config(self.model, 480, 832, self.m)

    def test_real_native_api_adapter_preserves_input_and_never_repeats_success(self):
        self.approve()
        calls = []
        class Pipeline:
            def __init__(self, **k): calls.append(('init', k))
            def create_generator(self, **k): calls.append(('create', json.loads(Path(k['config_json']).read_text()), k['fps']))
            def generate(self, *, seed, prompt, image_path, save_result_path, size, num_frames):
                # Pinned Wan22MoeRunner removes negative_prompt when CFG is false.
                k = dict(seed=seed, prompt=prompt, image_path=image_path, save_result_path=save_result_path, size=size, num_frames=num_frames)
                calls.append(('generate', k))
                Path(k['save_result_path']).write_bytes(b'0000ftyp' + b'x' * 40)
        observed = {'width': 720, 'height': 1280, 'numFrames': 81, 'fps': 16,
                    'durationMs': 5062.5, 'hasAudio': False}
        e = r.LightWanRuntime(self.model, self.work, expected_scope=self.scope,
                             pipeline_factory=Pipeline, stack_probe=lambda m: None,
                             verify_video=lambda p: observed)
        out = e.generate(self.request(), self.root / 'output')
        self.assertEqual(out['revision'], self.m['revision'])
        self.assertEqual(out['steps'], 4)
        self.assertEqual(out['quantization'], 'NVFP4')
        self.assertFalse(out['qualityCertified'])
        self.assertIsNone(out['vaeDecodeSeconds'])
        kwargs = calls[-1][1]
        self.assertEqual(kwargs['prompt'], self.request()['prompt'])
        self.assertEqual(Path(kwargs['image_path']).read_bytes(), self.request()['reference_images'][0])
        self.assertEqual(kwargs['size'], (1280, 720))
        self.assertEqual(kwargs['num_frames'], 81)
        with self.assertRaisesRegex(RuntimeError, 'ALREADY_EXISTS'):
            e.generate(self.request(), self.root / 'output')
        self.assertEqual(sum(c[0] == 'generate' for c in calls), 1)

    def test_hardware_preflight_rejects_wrong_gpu_or_cuda_without_model_start(self):
        cuda = types.SimpleNamespace(is_available=lambda: True, get_device_capability=lambda: (8, 9),
                                     get_device_properties=lambda n: types.SimpleNamespace(total_memory=96 * 2**30))
        torch = types.SimpleNamespace(cuda=cuda, version=types.SimpleNamespace(cuda='13.0'))
        with patch.dict(sys.modules, {'torch': torch}):
            with self.assertRaisesRegex(RuntimeError, 'BLACKWELL'):
                r.verify_stack(self.m)
            cuda.get_device_capability = lambda: (12, 0)
            torch.version.cuda = '12.8'
            with self.assertRaisesRegex(RuntimeError, 'CUDA13'):
                r.verify_stack(self.m)
            torch.version.cuda = '13.0'
            with patch.object(r.importlib.util, 'find_spec', return_value=None):
                with self.assertRaisesRegex(RuntimeError, 'KERNELS'):
                    r.verify_stack(self.m)

    def test_kernel_abi_failure_blocks_before_loading(self):
        cuda = types.SimpleNamespace(is_available=lambda: True, get_device_capability=lambda: (12, 0),
                                     get_device_properties=lambda n: types.SimpleNamespace(total_memory=96 * 2**30))
        torch = types.SimpleNamespace(cuda=cuda, version=types.SimpleNamespace(cuda='13.0'))
        with patch.dict(sys.modules, {'torch': torch}), patch.object(r.importlib.util, 'find_spec', return_value=True), patch.object(r.importlib, 'import_module', side_effect=ImportError('ABI mismatch')):
            with self.assertRaisesRegex(RuntimeError, 'KERNEL_ABI_NOT_READY'):
                r.verify_stack(self.m)

    def test_cpu_preparation_canonicalizes_modal_mount_before_safe_child_validation(self):
        from unittest.mock import MagicMock
        c = {**self.scope, 'modelVolume': 'model-volume', 'resultsVolume': 'result-volume',
             'weightPath': 'models/wan22-i2v-a14b/' + self.scope['engineId'] + '/accelerated/' + cloud.manifest()['revision'],
             'gpu': 'RTX-PRO-6000', 'cpu': 4, 'ramGiB': 128, 'width': 720, 'height': 1280}
        canonical = self.root / 'platform-owned-volume'
        canonical.mkdir()
        with patch.object(cloud, 'canonical_mount', return_value=canonical, create=True) as anchor, patch.object(cloud.modal.Volume, 'from_name', return_value=MagicMock()), patch.object(prep, 'prepare_lightwan', return_value={'ready': True}) as run:
            cloud.prepare_native({'approved': True}, c)
        anchor.assert_called_once_with('/models')
        self.assertEqual(run.call_args.args[1], canonical / c['weightPath'])

    def test_native_renamed_and_official_legacy_kernels_require_real_nvfp4_ops(self):
        gemm = types.SimpleNamespace(cutlass_scaled_nvfp4_mm=lambda: None, scaled_nvfp4_quant=lambda: None)
        ops = types.SimpleNamespace(cutlass_scaled_nvfp4_mm_sm120=True, scaled_nvfp4_quant_sm120=True)
        torch = types.SimpleNamespace(ops=types.SimpleNamespace(lightx2v_kernel=ops))
        for package in ('lightx2v_kernel_nvidia', 'lightx2v_kernel'):
            with patch.object(r.importlib.util, 'find_spec', side_effect=lambda name: True if name == package else None), patch.object(r.importlib, 'import_module', side_effect=lambda name: gemm if name.endswith('.gemm') else types.SimpleNamespace()):
                self.assertEqual(r.verify_native_kernels(torch)['package'], package)
                with self.assertRaisesRegex(RuntimeError, 'OPERATORS_NOT_READY'):
                    r.verify_native_kernels(types.SimpleNamespace())
                with patch.object(gemm, 'scaled_nvfp4_quant', None):
                    with self.assertRaisesRegex(RuntimeError, 'API_NOT_READY'):
                        r.verify_native_kernels(torch)

    def test_broken_renamed_kernel_does_not_silently_fall_back_to_legacy(self):
        with patch.object(r.importlib.util, 'find_spec', return_value=True), patch.object(r.importlib, 'import_module', side_effect=ImportError('broken ABI')) as load:
            with self.assertRaisesRegex(RuntimeError, 'ABI_NOT_READY'):
                r.verify_native_kernels(types.SimpleNamespace())
        load.assert_called_once_with('lightx2v_kernel_nvidia')

    def test_deployment_environment_is_function_config_not_build_after_local_mount(self):
        class Image:
            mounted = False
            def run_commands(self, *args): return self
            def env(self, value):
                if self.mounted: raise RuntimeError('BUILD_AFTER_LOCAL_MOUNT')
                return self
            def add_local_dir(self, *args, **kwargs): self.mounted = True; return self
        class Volume:
            def with_mount_options(self, **kwargs): return self
        class App:
            def __init__(self, name): self.options = None
            def cls(self, **kwargs): self.options = kwargs; return lambda cls: cls
        sdk = types.SimpleNamespace(Image=types.SimpleNamespace(from_registry=lambda x: Image()), Volume=types.SimpleNamespace(from_name=lambda *a, **k: Volume()), App=App)
        c = {**self.scope, 'modelVolume': 'model-volume', 'resultsVolume': 'result-volume',
             'weightPath': 'models/wan22-i2v-a14b/' + self.scope['engineId'] + '/accelerated/' + cloud.manifest()['revision'],
             'gpu': 'RTX-PRO-6000', 'cpu': 4, 'ramGiB': 128, 'width': 720, 'height': 1280}
        app, _ = cloud.build_lightwan_app(c, sdk=sdk)
        self.assertEqual(json.loads(app.options['env'][cloud.ENV]), c)

    def test_five_clip_batch_keeps_one_runtime_and_commits_every_success(self):
        from unittest.mock import MagicMock
        class Runtime:
            loads = 0
            calls = 0
            def prepare(self): self.loads += 1; return {'loadSeconds': 33}
            def generate(inner, request, folder):
                inner.calls += 1
                video = folder / 'video.mp4'; video.write_bytes(b'preserved')
                return {'videoPath': str(video), 'pipelineSeconds': inner.calls}
        runtime = Runtime()
        e = types.SimpleNamespace(config={**self.scope, 'width':720, 'height':1280}, runtime_id='batch1', runtime=runtime, results_root=self.root, results=MagicMock())
        items = [{'shotId':str(n), 'scope':{**self.scope,'runId':'batch1','requestId':'shot-'+str(n)}, 'request':self.request()} for n in range(5)]
        out = cloud.generate_owned_batch(e, items)
        self.assertEqual(runtime.loads, 1)
        self.assertEqual(runtime.calls, 5)
        self.assertEqual(out['status'], 'completed')
        self.assertEqual([v['loadSecondsForThisShot'] for v in out['completed']], [33,0,0,0,0])
        for item in items:
            self.assertEqual((self.root/'runs/batch1'/item['scope']['requestId']/'video.mp4').read_bytes(), b'preserved')
        with self.assertRaises(FileExistsError): cloud.generate_owned_batch(e, items)
        self.assertEqual(runtime.calls, 5)

    def test_batch_failure_preserves_completed_clips_and_foreign_scope_never_loads(self):
        from unittest.mock import MagicMock
        class Runtime:
            calls = 0
            def prepare(self): return {'loadSeconds': 1}
            def generate(inner, request, folder):
                inner.calls += 1
                if inner.calls == 2: raise RuntimeError('stop')
                video=folder/'video.mp4';video.write_bytes(b'first')
                return {'videoPath':str(video)}
        runtime=Runtime()
        e=types.SimpleNamespace(config={**self.scope,'width':720,'height':1280},runtime_id='batch2',runtime=runtime,results_root=self.root,results=MagicMock())
        items=[{'shotId':str(n),'scope':{**self.scope,'runId':'batch2','requestId':'shot-'+str(n)},'request':self.request()} for n in range(3)]
        foreign=copy.deepcopy(items);foreign[0]['scope']['accountId']='another'
        with self.assertRaisesRegex(ValueError,'SCOPE'): cloud.generate_owned_batch(e, foreign)
        self.assertEqual(runtime.calls,0)
        self.assertFalse((self.root/'runs/batch2').exists())
        with self.assertRaisesRegex(RuntimeError,'stop'): cloud.generate_owned_batch(e, items)
        saved=json.loads((self.root/'runs/batch2/batch-progress.json').read_text())
        self.assertEqual(len(saved['completed']),1)
        self.assertEqual((self.root/'runs/batch2/shot-0/video.mp4').read_bytes(),b'first')
        self.assertFalse((self.root/'runs/batch2/shot-2').exists())

    def test_real_sdk_definition_never_connects_or_serializes_nested_class(self):
        from modal._utils.async_utils import synchronizer
        from modal.client import _Client
        c = {**self.scope, 'modelVolume': 'model-volume', 'resultsVolume': 'result-volume',
             'weightPath': 'models/wan22-i2v-a14b/' + self.scope['engineId'] + '/accelerated/' + cloud.manifest()['revision'],
             'gpu': 'RTX-PRO-6000', 'cpu': 4, 'ramGiB': 128, 'width': 720, 'height': 1280}
        with patch.object(_Client, 'from_env', side_effect=AssertionError('NO_CLOUD')):
            app, cls = cloud.build_lightwan_app(c)
        self.assertTrue(cls)
        self.assertEqual(set(app.registered_functions), {'LightWanEngine.*'})
        for fn in app.registered_functions.values():
            self.assertFalse(synchronizer._translate_in(fn)._get_source_info().is_serialized())

    def test_private_trial_limits_are_bounded_without_changing_default_factory(self):
        c = {**self.scope, 'modelVolume': 'model-volume', 'resultsVolume': 'result-volume',
             'weightPath': 'models/wan22-i2v-a14b/' + self.scope['engineId'] + '/accelerated/' + cloud.manifest()['revision'],
             'gpu': 'RTX-PRO-6000', 'cpu': 4, 'ramGiB': 128, 'width': 720, 'height': 1280}
        from modal.client import _Client
        with patch.object(_Client, 'from_env', side_effect=AssertionError('NO_CLOUD')):
            app, cls = cloud.build_lightwan_app(c, trial_limits={'timeout':180,'startupTimeout':180})
            self.assertTrue(cls)
            for bad in ({'timeout':1,'startupTimeout':180},{'timeout':180,'startupTimeout':True},{'timeout':180,'startupTimeout':180,'gpu':'other'}):
                with self.assertRaisesRegex(ValueError,'TRIAL_LIMIT_INVALID'):cloud.build_lightwan_app(c,trial_limits=bad)

    def test_deployment_separates_weights_and_has_fixed_smaller_resources(self):
        m = cloud.manifest()
        c = {**self.scope, 'modelVolume': 'model-volume', 'resultsVolume': 'result-volume',
             'weightPath': 'models/wan22-i2v-a14b/' + self.scope['engineId'] + '/accelerated/' + m['revision'],
             'gpu': 'RTX-PRO-6000', 'cpu': 4, 'ramGiB': 128, 'width': 720, 'height': 1280}
        self.assertEqual(cloud.deployment_config(c), c)
        for field, value in [('weightPath', 'models/original'), ('gpu', 'L40S'), ('cpu', 8), ('ramGiB', 256)]:
            with self.assertRaisesRegex(ValueError, 'INVALID_DEPLOYMENT'):
                cloud.deployment_config({**c, field: value})


if __name__ == '__main__':
    unittest.main()
