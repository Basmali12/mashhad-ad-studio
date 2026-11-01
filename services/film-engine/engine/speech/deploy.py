"""Explicit approved bootstrap only; importing this file never contacts Modal.

Image build, storage and network costs belong in the server-owned preparation
quote. A generation/start request must never call this helper as a fallback.
"""
import io
import json
import hashlib
from pathlib import Path
from .runtime import manifest_for,manifest_fingerprint,validate_scope
from .modal_app import build_speech_app,deployment_config


def bundle_fingerprint():
    root=Path(__file__).resolve().parent
    files=sorted([*root.glob('*.py'),*root.glob('*.lock'),*root.glob('manifests/*.json')])
    digest=hashlib.sha256()
    for file in files:digest.update(str(file.relative_to(root)).encode()+b'\0'+hashlib.sha256(file.read_bytes()).digest())
    return digest.hexdigest()


def _scope_matches(saved,config):
    return all(saved.get(key)==config[key] for key in ('modelId','engineId','accountId','appName','modelVolume','resultsVolume','weightPath')) and saved.get('manifestFingerprint')==manifest_fingerprint(config['modelId'])


def config_for_packet(packet):
    definition=packet.get('definition',{})
    engine_id=definition.get('id')
    if not isinstance(engine_id,str):raise ValueError('SPEECH_INVALID_DEPLOYMENT')
    model_id=definition.get('modelId');manifest_for(model_id)
    result_volume='mashhad-speech-'+model_id+'-results-'+hashlib.sha256(engine_id.encode()).hexdigest()[:16]
    config=deployment_config({'modelId':model_id,'engineId':engine_id,'accountId':definition.get('accountId'),
        'modelVolume':definition.get('volume'),'resultsVolume':result_volume,'weightPath':definition.get('weightPath'),
        'gpu':definition.get('gpu'),'cpu':definition.get('cpu'),'ramGiB':definition.get('ramGiB'),
        'timeout':definition.get('timeout',600),'startupTimeout':definition.get('startupTimeout',180),
        'idleSeconds':definition.get('idleSeconds',1200)})
    if packet.get('appName',config['appName'])!=config['appName'] or packet.get('resultsVolume',result_volume)!=result_volume:
        raise ValueError('SPEECH_SCOPE_MISMATCH')
    return config


def deploy_speech_app(packet,*,client,sdk=None):
    if not isinstance(packet,dict) or packet.get('paidApproved') is not True:
        raise ValueError('SPEECH_PREPARATION_APPROVAL_REQUIRED')
    config=config_for_packet(packet);manifest=manifest_for(config['modelId'])
    if config['modelId']=='audar-tts-v1-flash' and packet.get('licenseAccepted') is not True:raise ValueError('SPEECH_LICENSE_ACCEPTANCE_REQUIRED')
    if config['modelId']=='audar-tts-v1-flash' and packet.get('codecLicenseAccepted') is not True:raise ValueError('SPEECH_CODEC_LICENSE_ACCEPTANCE_REQUIRED')
    if packet.get('manifestFingerprint')!=manifest_fingerprint(config['modelId']) or packet.get('modelRevision',packet.get('manifest',{}).get('revision'))!=manifest['revision']:
        raise ValueError('SPEECH_MANIFEST_MISMATCH')
    config=config_for_packet(packet)
    validate_scope(packet.get('scope'),config['engineId'],config['accountId'],request_required=True)
    if sdk is None:import modal as sdk
    if config['modelId']=='audar-tts-v1-flash':
        try:sdk.Secret.from_name('mashhad-hf-read',client=client,environment_name='main').hydrate()
        except Exception:raise RuntimeError('SPEECH_CODEC_AUTHORIZATION_REQUIRED') from None
    existing=None
    try:existing=sdk.App.lookup(config['appName'],client=client,environment_name='main',create_if_missing=False)
    except sdk.exception.NotFoundError:pass
    if existing is not None:
        # An app name alone never proves ownership or permission to replace it.
        volume=sdk.Volume.from_name(config['resultsVolume'],client=client,create_if_missing=False,environment_name='main')
        try:saved=json.loads(b''.join(volume.read_file('deployment.json')))
        except Exception:raise RuntimeError('SPEECH_DEPLOYMENT_OWNERSHIP_UNCONFIRMED') from None
        if not _scope_matches(saved,config) or saved.get('appId')!=existing.app_id or saved.get('bundleFingerprint')!=bundle_fingerprint():
            raise RuntimeError('SPEECH_DEPLOYMENT_OWNERSHIP_UNCONFIRMED')
        cls=sdk.Cls.from_name(config['appName'],'SpeechEngine',client=client,environment_name='main');cls.hydrate()
        if saved.get('classId')!=cls.object_id:raise RuntimeError('SPEECH_DEPLOYMENT_OWNERSHIP_UNCONFIRMED')
        return {**saved,'reused':True,'deploymentReady':True}
    # A stopped deployment can disappear from name lookup while its persistent
    # result Volume remains. Never overwrite an unowned preexisting Volume.
    result_volume=None;prior=None
    try:
        result_volume=sdk.Volume.from_name(config['resultsVolume'],client=client,create_if_missing=False,environment_name='main');result_volume.hydrate()
    except sdk.exception.NotFoundError:result_volume=None
    if result_volume is not None:
        prior=None
        for name in ('deployment.json','deployment-claim.json'):
            try:prior=json.loads(b''.join(result_volume.read_file(name)));break
            except Exception:pass
        if not prior or not _scope_matches(prior,config):raise RuntimeError('SPEECH_DEPLOYMENT_OWNERSHIP_UNCONFIRMED')
    # Only this approved bootstrap path may create the two new scoped Volumes.
    for key in ('modelVolume','resultsVolume'):
        volume=sdk.Volume.from_name(config[key],client=client,create_if_missing=True,environment_name='main');volume.hydrate()
    result_volume=sdk.Volume.from_name(config['resultsVolume'],client=client,create_if_missing=False,environment_name='main')
    if prior is None:
        with result_volume.batch_upload(force=False) as batch:batch.put_file(io.BytesIO(json.dumps({**config,'manifestFingerprint':manifest_fingerprint(config['modelId'])},sort_keys=True).encode()),'deployment-claim.json')
    app,cls=build_speech_app({key:value for key,value in config.items() if key!='appName'},sdk=sdk)
    app.deploy(name=config['appName'],client=client,environment_name='main')
    remote=sdk.Cls.from_name(config['appName'],'SpeechEngine',client=client,environment_name='main');remote.hydrate()
    attestation={**config,'appId':app.app_id,'classId':remote.object_id,'manifestFingerprint':manifest_fingerprint(config['modelId']),
        'modelRevision':manifest['revision'],'bundleFingerprint':bundle_fingerprint(),'runtimeVersion':'mashhad-speech-runtime-v1','imageDependencies':'requirements-gpu.lock',
        'gpuStarted':False,'deploymentReady':True}
    volume=sdk.Volume.from_name(config['resultsVolume'],client=client,create_if_missing=False,environment_name='main')
    with volume.batch_upload(force=True) as batch:batch.put_file(io.BytesIO(json.dumps(attestation,sort_keys=True).encode()),'deployment.json')
    return attestation
