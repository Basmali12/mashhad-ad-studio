"""Inert isolated Modal factory. Defining an Image/App does not deploy it.

No existing App is looked up, replaced or stopped. No account secrets in Images.
External bootstrap/commissioning still needs explicit quote, verified preparation,
kernel preflight, new manifest proof and a fresh finite spend/stop lease.
"""
import json
import time
import os
import modal
import re
from pathlib import Path
from .lightwan_runtime import LightWanRuntime, manifest
from .runtime import validate_scope, validate_request
from .storage import canonical_mount, scoped_directory

ROOT = Path(__file__).resolve().parent
ENV = 'MASHHAD_LIGHTWAN_DEPLOYMENT'


def deployment_config(c):
    m = manifest()
    if not isinstance(c, dict) or set(c) != {'engineId', 'accountId', 'modelVolume', 'resultsVolume', 'weightPath', 'gpu', 'cpu', 'ramGiB', 'width', 'height'}:
        raise ValueError('LIGHTWAN_INVALID_DEPLOYMENT')
    if not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', c['engineId']) or any(not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', c[k]) for k in ('accountId', 'modelVolume', 'resultsVolume')) or c['modelVolume'] == c['resultsVolume']:
        raise ValueError('LIGHTWAN_INVALID_DEPLOYMENT')
    # Original weights/READY markers cannot serve as accelerated readiness.
    expected = 'models/wan22-i2v-a14b/' + c['engineId'] + '/accelerated/' + m['revision']
    if c['weightPath'] != expected or c['gpu'] != 'RTX-PRO-6000' or c['cpu'] != 4 or c['ramGiB'] != 128 or (c['width'], c['height']) not in ((720, 1280), (1280, 720)):
        raise ValueError('LIGHTWAN_INVALID_DEPLOYMENT')
    return c


def build_lightwan_image(sdk):
    m = manifest()
    # Immutable upstream recommended Linux/amd64 image. Not pulled by this module.
    image = m['runtime']['image']
    digest = m['runtime'].get('imageDigest') or m['runtime'].get('digest')
    if not digest:
        raise RuntimeError('LIGHTWAN_IMAGE_PIN_REQUIRED')
    source = m['sourceCommit']
    return (sdk.Image.from_registry(image.split(':')[0] + '@' + digest)
            .run_commands('git clone https://github.com/ModelTC/LightX2V.git /opt/lightx2v',
                          'git -C /opt/lightx2v checkout --detach ' + source,
                          'git -C /opt/lightx2v rev-parse HEAD > /opt/lightx2v/MASHHAD_SOURCE_COMMIT',
                          'python -m pip install --no-deps -e /opt/lightx2v')
            .env({'HF_HUB_OFFLINE': '1', 'TRANSFORMERS_OFFLINE': '1', 'HF_HUB_DISABLE_TELEMETRY': '1'})
            .add_local_dir(ROOT, '/root/wan', ignore=['__pycache__', '*.pyc']))


def prepare_native(request, config):
    """Explicit CPU-only provisioning, registered only by approved private controller."""
    from .lightwan_prepare import prepare_lightwan
    c = deployment_config(config)
    volume = modal.Volume.from_name(c['modelVolume'], create_if_missing=False)
    try:
        value = prepare_lightwan(request, scoped_directory(canonical_mount('/models'), c['weightPath']),
                                engine_id=c['engineId'], account_id=c['accountId'])
        volume.commit()
        return value
    finally:
        volume.commit()


def inspect_native_stack():
    """Explicit CPU inspection of the existing image; no weights/model/inference."""
    import importlib.util
    from importlib.metadata import version, PackageNotFoundError
    import torch
    from .lightwan_runtime import verify_native_kernels
    packages = {}
    for name in ('torch','lightx2v','lightx2v-kernel-nvidia','lightx2v-kernel','sageattention','spas-sage-attn'):
        try: packages[name] = version(name)
        except PackageNotFoundError: packages[name] = None
    modules = {name: importlib.util.find_spec(name) is not None for name in
               ('lightx2v_kernel_nvidia','lightx2v_kernel','sageattention','spas_sage_attn')}
    try:
        verified = verify_native_kernels(torch)
        result = {'ready': True, 'kernelProof': verified}
    except (ImportError, OSError, RuntimeError) as exc:
        text = str(exc)
        code = text if text.startswith('LIGHTWAN_') and text.replace('_','').isalnum() else type(exc).__name__
        result = {'ready': False, 'code': code}
    return {**result, 'packages': packages, 'modules': modules,
            'cudaVersion': torch.version.cuda, 'gpuRequested': False, 'inferenceUsed': False}


class LightWanEngine:
    runtime_id: str = modal.parameter()

    @modal.enter()
    def initialize(self):
        c = self.config = deployment_config(json.loads(os.environ[ENV]))
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', self.runtime_id):
            raise ValueError('LIGHTWAN_INVALID_RUNTIME_ID')
        self.results_root = canonical_mount('/results')
        self.runtime = LightWanRuntime(scoped_directory(canonical_mount('/models'), c['weightPath']),
                                      scoped_directory(self.results_root, 'runs/' + self.runtime_id),
                                      expected_scope={'engineId': c['engineId'], 'accountId': c['accountId']},
                                      width=c['width'], height=c['height'])
        self.results = modal.Volume.from_name(c['resultsVolume'], create_if_missing=False)

    @modal.method()
    def start(self, scope):
        c = self.config
        validate_scope(scope, c['engineId'], c['accountId'], self.runtime_id)
        return {**self.runtime.prepare(), 'scope': scope}

    @modal.method()
    def generate(self, request, scope):
        value = generate_owned_clip(self, request, scope)
        return {**value, 'mp4Bytes': Path(value['videoPath']).read_bytes()}

    @modal.method()
    def generate_batch(self, items):
        return generate_owned_batch(self, items)


def validate_batch(items, config, runtime_id):
    if not isinstance(items, list) or not 1 <= len(items) <= 5:
        raise ValueError('LIGHTWAN_BATCH_INVALID')
    ids, shots = set(), set()
    for item in items:
        if not isinstance(item, dict) or set(item) != {'request', 'scope', 'shotId'}:
            raise ValueError('LIGHTWAN_BATCH_INVALID')
        validate_scope(item['scope'], config['engineId'], config['accountId'], runtime_id, request_required=True)
        if item['scope']['requestId'] in ids or item['shotId'] in shots or not re.fullmatch(r'[A-Za-z0-9_-]{1,60}', item['shotId']):
            raise ValueError('LIGHTWAN_BATCH_DUPLICATE')
        ids.add(item['scope']['requestId'])
        shots.add(item['shotId'])
        value = validate_request(item['request'])
        if (value['width'], value['height']) != (config['width'], config['height']) or value['num_frames'] != 81 or value['fps'] != 16:
            raise ValueError('LIGHTWAN_BATCH_GEOMETRY_INVALID')
    return items


def generate_owned_clip(engine, request, scope):
    c = engine.config
    validate_scope(scope, c['engineId'], c['accountId'], engine.runtime_id, request_required=True)
    folder = scoped_directory(engine.results_root, 'runs/' + engine.runtime_id + '/' + scope['requestId'])
    if folder.exists():
        raise RuntimeError('LIGHTWAN_RESULT_UNCERTAIN_NO_RETRY')
    folder.mkdir(parents=True, exist_ok=False, mode=0o700)
    engine.results.commit()
    generated = engine.runtime.generate(request, folder)
    value = {**generated, 'scope': scope, 'engineId': c['engineId'], 'accountId': c['accountId'],
             'runId': engine.runtime_id, 'modelRevision': manifest()['revision'], 'status': 'completed'}
    (folder / 'receipt.json').write_text(json.dumps(value, sort_keys=True), encoding='utf-8')
    engine.results.commit()
    return value


def generate_owned_batch(engine, items):
    validate_batch(items, engine.config, engine.runtime_id)
    root = scoped_directory(engine.results_root, 'runs/' + engine.runtime_id)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Durable batch claim plus individual clip claims forbid replay after uncertainty.
    with (root / 'batch-claim.json').open('x', encoding='utf-8') as f:
        json.dump({'requests': [i['scope']['requestId'] for i in items]}, f)
    engine.results.commit()
    started = time.monotonic()
    loaded = engine.runtime.prepare()
    completed = []
    for index, item in enumerate(items):
        value = generate_owned_clip(engine, item['request'], item['scope'])
        value.update(shotId=item['shotId'], modelWarmReused=index > 0,
                     loadSecondsForThisShot=loaded.get('loadSeconds', 0) if index == 0 else 0)
        completed.append(value)
        checkpoint = {'status': 'completed' if len(completed) == len(items) else 'running',
                      'completed': completed, 'total': len(items),
                      'elapsedSeconds': time.monotonic() - started}
        pending = root / 'batch-progress.pending.json'
        pending.write_text(json.dumps(checkpoint, sort_keys=True), encoding='utf-8')
        pending.replace(root / 'batch-progress.json')
        engine.results.commit()
    return checkpoint


def build_lightwan_app(config, sdk=None, *, trial_limits=None):
    c = deployment_config(config)
    if sdk is None:
        sdk = modal
    execution_timeout,startup_timeout=600,300
    if trial_limits is not None:
        if not isinstance(trial_limits,dict) or set(trial_limits)!={'timeout','startupTimeout'}:raise ValueError('LIGHTWAN_TRIAL_LIMIT_INVALID')
        execution_timeout,startup_timeout=trial_limits['timeout'],trial_limits['startupTimeout']
        if type(execution_timeout) is not int or type(startup_timeout) is not int or not 180<=execution_timeout<=600 or not 60<=startup_timeout<=300:raise ValueError('LIGHTWAN_TRIAL_LIMIT_INVALID')
    app = sdk.App('mashhad-lightwan-' + c['engineId'].replace('-', '')[:12])
    weights = sdk.Volume.from_name(c['modelVolume'], create_if_missing=False)
    results = sdk.Volume.from_name(c['resultsVolume'], create_if_missing=False)
    image = build_lightwan_image(sdk)
    remote = app.cls(image=image, env={ENV: json.dumps(c, sort_keys=True)}, gpu='RTX-PRO-6000', cpu=(4, 4),
                     memory=(131072, 131072), timeout=execution_timeout, startup_timeout=startup_timeout,
                     max_containers=1, min_containers=0, buffer_containers=0,
                     scaledown_window=2, retries=0, include_source=False,
                     volumes={'/models': weights.with_mount_options(read_only=True), '/results': results})(LightWanEngine)
    return app, remote
