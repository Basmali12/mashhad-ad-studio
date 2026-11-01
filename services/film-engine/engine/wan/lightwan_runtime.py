"""Isolated, offline LightWan NVFP4 runtime. Import never builds/downloads/starts.

Original WanVideoRuntime, weights and all successful outputs remain untouched.
The installed, pinned LightX2V stack and separately verified native files are
mandatory; no Diffusers fallback and no on-demand checkpoint acquisition.
"""
import hashlib
import importlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import time

from .runtime import validate_request

ROOT = Path(__file__).resolve().parent
MANIFEST_FILE = ROOT / 'accelerated-manifest.json'


def manifest():
    return json.loads(MANIFEST_FILE.read_text(encoding='utf-8'))


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def verify_ready(root, expected_scope):
    root = Path(root)
    if root.is_symlink() or root.resolve() != root.absolute():
        raise RuntimeError('LIGHTWAN_UNSAFE_STORAGE')
    m = manifest()
    marker = root / 'LIGHTWAN_READY.json'
    if not marker.is_file() or marker.is_symlink():
        raise RuntimeError('LIGHTWAN_WEIGHTS_NOT_READY')
    proof = json.loads(marker.read_text(encoding='utf-8'))
    if proof.get('hashVerified') is not True or proof.get('manifestFingerprint') != fingerprint(m) or any(proof.get(k) != v for k, v in expected_scope.items()):
        raise RuntimeError('LIGHTWAN_WEIGHTS_NOT_READY')
    indexed = {f['path']: f for f in proof.get('files', [])}
    for spec in m['files']:
        file = root / spec['path']
        if not file.resolve().is_relative_to(root.resolve()) or file.is_symlink() or not file.is_file() or file.stat().st_size != spec['size'] or indexed.get(spec['path']) != {k: spec[k] for k in ('path', 'size', 'sha256')}:
            raise RuntimeError('LIGHTWAN_WEIGHTS_NOT_READY')
    return m


def native_config(root, width, height, m=None):
    m = m or manifest()
    if (width, height) not in ((720, 1280), (1280, 720)):
        raise ValueError('LIGHTWAN_720P_REQUIRED')
    roles = {s['role']: str(Path(root) / s['path']) for s in m['files']}
    if 'high_noise_nvfp4' not in roles or 'low_noise_nvfp4' not in roles:
        raise RuntimeError('LIGHTWAN_EXPERT_PAIR_REQUIRED')
    return {'infer_steps': 4, 'num_frames': 81, 'text_len': 512,
            'size': [height, width], 'distill_method': 'dmd2',
            'warmup': False, 'feature_caching': 'NoCaching', 'parallel': False,
            'self_attn_1_type': 'dynamic_sparse_attn',
            'dynamic_sparse_attn_setting': {'sparsity_ratio': 0.9, 'operator': 'sage2'},
            'cross_attn_1_type': 'sage_attn2', 'sample_guide_scale': [3.5, 3.5],
            'sample_shift': 7.0, 'enable_cfg': False, 'cpu_offload': False,
            't5_cpu_offload': True, 'vae_cpu_offload': False, 'use_image_encoder': False,
            'boundary_step_index': 2, 'denoising_step_list': [1000, 750, 500, 250],
            'dit_quantized': True, 'dit_quant_scheme': 'nvfp4',
            'high_noise_quantized_ckpt': roles['high_noise_nvfp4'],
            'low_noise_quantized_ckpt': roles['low_noise_nvfp4'],
            'high_noise_original_ckpt': None, 'low_noise_original_ckpt': None}


def verify_native_kernels(torch):
    """Follow pinned upstream compatibility, verifying actual NVFP4 operators.

    A broken new package never silently falls back. The legacy package is only
    selected when the renamed distribution is absent, as upstream documents.
    CPU-only inspection is possible; no tensors/inference/downloads here.
    """
    module = 'lightx2v_kernel_nvidia'
    if importlib.util.find_spec(module) is None:
        module = 'lightx2v_kernel'
        if importlib.util.find_spec(module) is None:
            raise RuntimeError('LIGHTWAN_KERNELS_NOT_READY_NVFP4_PACKAGE')
    required = [module, module + '.gemm', 'sageattention',
                'spas_sage_attn', 'spas_sage_attn._fused', 'spas_sage_attn._qattn']
    loaded = {}
    for name in required:
        try:
            loaded[name] = importlib.import_module(name)
        except (ImportError, OSError, RuntimeError) as exc:
            raise RuntimeError('LIGHTWAN_KERNEL_ABI_NOT_READY_' + name.replace('.', '_')) from exc
    gemm = loaded[module + '.gemm']
    if any(not callable(getattr(gemm, name, None)) for name in ('cutlass_scaled_nvfp4_mm', 'scaled_nvfp4_quant')):
        raise RuntimeError('LIGHTWAN_NVFP4_API_NOT_READY')
    namespace = getattr(getattr(torch, 'ops', None), 'lightx2v_kernel', None)
    if namespace is None or any(not hasattr(namespace, name) for name in
                              ('cutlass_scaled_nvfp4_mm_sm120', 'scaled_nvfp4_quant_sm120')):
        raise RuntimeError('LIGHTWAN_NVFP4_OPERATORS_NOT_READY')
    return {'package': module, 'nvfp4OperatorsRegistered': True, 'nativeAttentionImports': True}


def verify_stack(m):
    # This probe runs only in the explicitly started cloud runtime, never import.
    import torch
    if not torch.cuda.is_available() or torch.cuda.get_device_capability() != (12, 0) or torch.cuda.get_device_properties(0).total_memory < 90 * 2**30:
        raise RuntimeError('LIGHTWAN_BLACKWELL_96GB_REQUIRED')
    if not torch.version.cuda or tuple(map(int, torch.version.cuda.split('.')[:2])) < (13, 0):
        raise RuntimeError('LIGHTWAN_CUDA13_REQUIRED')
    verify_native_kernels(torch)
    source = Path('/opt/lightx2v')
    pin = source / 'MASHHAD_SOURCE_COMMIT'
    if not pin.is_file() or pin.read_text().strip() != m['sourceCommit']:
        raise RuntimeError('LIGHTWAN_SOURCE_PIN_MISMATCH')
    import lightx2v
    if not Path(lightx2v.__file__).resolve().is_relative_to(source):
        raise RuntimeError('LIGHTWAN_SOURCE_PIN_MISMATCH')
    return torch


def inspect_video(file):
    p = subprocess.run(['ffprobe', '-v', 'error', '-count_frames', '-show_entries',
                        'stream=codec_type,width,height,nb_read_frames,avg_frame_rate:format=duration',
                        '-of', 'json', str(file)], capture_output=True, timeout=60, check=True)
    info = json.loads(p.stdout)
    streams = info.get('streams', [])
    if len(streams) != 1 or streams[0].get('codec_type') != 'video':
        raise RuntimeError('LIGHTWAN_INVALID_OUTPUT')
    s = streams[0]
    n, d = s['avg_frame_rate'].split('/')
    return {'width': s['width'], 'height': s['height'], 'numFrames': int(s['nb_read_frames']),
            'fps': int(n) / int(d), 'durationMs': float(info['format']['duration']) * 1000,
            'hasAudio': False}


class LightWanRuntime:
    def __init__(self, model_dir, work_dir, *, expected_scope, width=720, height=1280,
                 pipeline_factory=None, stack_probe=verify_stack, verify_video=inspect_video):
        self.root, self.work = Path(model_dir), Path(work_dir)
        self.scope, self.width, self.height = expected_scope, width, height
        self.factory, self.probe, self.verify_video = pipeline_factory, stack_probe, verify_video
        self.pipeline = None

    def prepare(self):
        if self.pipeline is not None:
            return {'ready': True, 'loadSeconds': self.load_seconds, 'executionProfile': 'accelerated'}
        m = verify_ready(self.root, self.scope)
        self.work.mkdir(parents=True, exist_ok=True, mode=0o700)
        if self.work.is_symlink() or self.work.resolve() != self.work.absolute():
            raise RuntimeError('LIGHTWAN_UNSAFE_STORAGE')
        self.probe(m)
        for k in ('HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE', 'DIFFUSERS_OFFLINE'):
            os.environ[k] = '1'
        factory = self.factory
        if factory is None:
            from lightx2v import LightX2VPipeline
            factory = LightX2VPipeline
        config = self.work / 'lightwan-config.json'
        # Reopening the same config must not silently change a running profile.
        value = native_config(self.root, self.width, self.height, m)
        if config.exists() and json.loads(config.read_text()) != value:
            raise RuntimeError('LIGHTWAN_PROFILE_CHANGED')
        if not config.exists():
            with config.open('x', encoding='utf-8') as f:
                json.dump(value, f, sort_keys=True)
        started = time.monotonic()
        pipeline = factory(model_path=str(self.root / 'base'), model_cls='wan2.2_moe',
                           task='i2v', distill_method='dmd2')
        pipeline.create_generator(config_json=str(config), fps=16)
        self.pipeline, self.model_manifest = pipeline, m
        self.load_seconds = time.monotonic() - started
        return {'ready': True, 'loadSeconds': self.load_seconds, 'executionProfile': 'accelerated',
                'modelRevision': m['revision']}

    def generate(self, request, output_dir, on_progress=None):
        v = validate_request(request)
        if (v['width'], v['height']) != (self.width, self.height) or v['num_frames'] != 81 or v['fps'] != 16:
            raise ValueError('LIGHTWAN_COMPARISON_GEOMETRY_REQUIRED')
        self.prepare()
        folder = Path(output_dir)
        folder.mkdir(parents=True, exist_ok=True, mode=0o700)
        if folder.is_symlink() or folder.resolve() != folder.absolute():
            raise RuntimeError('LIGHTWAN_UNSAFE_STORAGE')
        output, image = folder / 'video.mp4', folder / 'reference.png'
        if output.exists() or output.is_symlink() or image.exists() or image.is_symlink():
            raise RuntimeError('LIGHTWAN_OUTPUT_ALREADY_EXISTS')
        # Original reference bytes are preserved: no resizing, repainting or JPEG.
        with image.open('xb') as f:
            f.write(v['reference_images'][0])
        if on_progress:
            on_progress({'phase': 'running', 'completed': None, 'total': 4})
        started = time.monotonic()
        # Upstream BaseRunner removes negative_prompt from supported request fields
        # when enable_cfg=false. Omit it; supplying even a constant is rejected.
        self.pipeline.generate(seed=v['seed'], prompt=v['prompt'],
                               image_path=str(image), save_result_path=str(output),
                               size=(self.height, self.width), num_frames=81)
        pipeline_seconds = time.monotonic() - started
        if output.is_symlink() or not output.is_file() or not 16 <= output.stat().st_size <= 64 * 1024 * 1024:
            raise RuntimeError('LIGHTWAN_INVALID_OUTPUT')
        checked = self.verify_video(output)
        if any(checked.get(k) != x for k, x in {'width': self.width, 'height': self.height,
                                              'numFrames': 81, 'fps': 16, 'hasAudio': False}.items()) or abs(checked['durationMs'] - 5062.5) > 1:
            raise RuntimeError('LIGHTWAN_INVALID_OUTPUT')
        metadata = {**checked, 'modelId': 'wan22-i2v-a14b', 'version': '2.2',
                    'revision': self.model_manifest['revision'], 'executionProfile': 'accelerated',
                    'sourceCommit': self.model_manifest['sourceCommit'], 'steps': 4, 'enableCfg': False,
                    'seed': v['seed'], 'mode': 'image_to_video', 'quantization': 'NVFP4',
                    'negativePromptCfgActive': False,
                    'attention': 'dynamic_sparse_attn/sage2', 'loadSeconds': self.load_seconds,
                    'pipelineSeconds': pipeline_seconds, 'denoisingSeconds': None, 'vaeDecodeSeconds': None,
                    'encodingSeconds': None, 'timingNote': 'Native pipeline includes decode/encoding; individual phases not instrumented.',
                    'referenceSHA256': hashlib.sha256(v['reference_images'][0]).hexdigest(),
                    'promptSHA256': hashlib.sha256(v['prompt'].encode()).hexdigest(),
                    'sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'bytes': output.stat().st_size,
                    'identityVerified': False, 'qualityCertified': False}
        with (folder / 'metadata.json').open('x', encoding='utf-8') as f:
            json.dump(metadata, f, sort_keys=True)
        if on_progress:
            on_progress({'phase': 'completed', 'completed': 4, 'total': 4})
        return {'videoPath': str(output), 'metadataPath': str(folder / 'metadata.json'), **metadata}
