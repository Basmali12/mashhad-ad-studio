"""Explicit future bootstrap only, guarded before image builds/Volume creation."""
import hashlib
import io
import json
from pathlib import Path
from .modal_app import build_latentsync_app,deployment_config
from .runtime import manifest_for,manifest_fingerprint,validate_scope


def bundle_fingerprint():
    root=Path(__file__).resolve().parent;digest=hashlib.sha256()
    for file in sorted([*root.glob('*.py'),*root.glob('*.lock'),root/'manifest.json']):digest.update(str(file.relative_to(root)).encode()+b'\0'+hashlib.sha256(file.read_bytes()).digest())
    return digest.hexdigest()


def config_for_packet(packet):
    d=packet.get('definition',{});engine_id=d.get('id')
    if not isinstance(engine_id,str):raise ValueError('LATENTSYNC_INVALID_DEPLOYMENT')
    results='mashhad-latentsync-results-'+hashlib.sha256(engine_id.encode()).hexdigest()[:16]
    config=deployment_config({'modelId':d.get('modelId'),'engineId':engine_id,'accountId':d.get('accountId'),'modelVolume':d.get('volume'),'resultsVolume':results,'weightPath':d.get('weightPath'),'gpu':d.get('gpu'),'cpu':d.get('cpu'),'ramGiB':d.get('ramGiB'),'timeout':d.get('timeout',600),'startupTimeout':d.get('startupTimeout',180),'idleSeconds':d.get('idleSeconds',1200)})
    if packet.get('appName',config['appName'])!=config['appName'] or packet.get('resultsVolume',results)!=results:raise ValueError('LATENTSYNC_SCOPE_MISMATCH')
    return config


def _matches(saved,config):
    return all(saved.get(k)==config[k] for k in ('modelId','engineId','accountId','modelVolume','resultsVolume','weightPath','appName')) and saved.get('manifestFingerprint')==manifest_fingerprint()


def deploy_latentsync_app(packet,*,paid_approved=False,license_accepted=False,face_model_rights_approved=False,rights_evidence='',usage_mode='commercial',research_only=False,client=None,sdk=None):
    if paid_approved is not True or not isinstance(packet,dict) or packet.get('paidApproved') is not True:raise ValueError('LATENTSYNC_PREPARATION_APPROVAL_REQUIRED')
    if usage_mode!='noncommercial_research' or research_only is not True or packet.get('usageMode')!='noncommercial_research' or packet.get('researchOnly') is not True:raise ValueError('LATENTSYNC_COMMERCIAL_RIGHTS_REQUIRED')
    if license_accepted is not True or face_model_rights_approved is not True or not isinstance(rights_evidence,str) or not 8<=len(rights_evidence.strip())<=1000:raise ValueError('LATENTSYNC_COMMERCIAL_RIGHTS_REQUIRED')
    config=config_for_packet(packet);manifest=manifest_for()
    if packet.get('manifestFingerprint')!=manifest_fingerprint() or packet.get('modelRevision',packet.get('manifest',{}).get('revision'))!=manifest['revision']:raise ValueError('LATENTSYNC_MANIFEST_MISMATCH')
    validate_scope(packet.get('scope'),config['engineId'],config['accountId'],request_required=True)
    if sdk is None:import modal as sdk
    existing=None
    try:existing=sdk.App.lookup(config['appName'],client=client,environment_name='main',create_if_missing=False)
    except sdk.exception.NotFoundError:pass
    if existing is not None:
        volume=sdk.Volume.from_name(config['resultsVolume'],client=client,create_if_missing=False,environment_name='main')
        try:saved=json.loads(b''.join(volume.read_file('deployment.json')))
        except Exception:raise RuntimeError('LATENTSYNC_DEPLOYMENT_OWNERSHIP_UNCONFIRMED') from None
        if not _matches(saved,config) or saved.get('appId')!=existing.app_id or saved.get('bundleFingerprint')!=bundle_fingerprint():raise RuntimeError('LATENTSYNC_DEPLOYMENT_OWNERSHIP_UNCONFIRMED')
        remote=sdk.Cls.from_name(config['appName'],'LatentSyncEngine',client=client,environment_name='main');remote.hydrate()
        if saved.get('classId')!=remote.object_id:raise RuntimeError('LATENTSYNC_DEPLOYMENT_OWNERSHIP_UNCONFIRMED')
        return {**saved,'reused':True,'deploymentReady':True}
    volume=None;prior=None
    try:volume=sdk.Volume.from_name(config['resultsVolume'],client=client,create_if_missing=False,environment_name='main');volume.hydrate()
    except sdk.exception.NotFoundError:volume=None
    if volume is not None:
        for name in ('deployment.json','deployment-claim.json'):
            try:prior=json.loads(b''.join(volume.read_file(name)));break
            except Exception:pass
        if not prior or not _matches(prior,config):raise RuntimeError('LATENTSYNC_DEPLOYMENT_OWNERSHIP_UNCONFIRMED')
    for key in ('modelVolume','resultsVolume'):sdk.Volume.from_name(config[key],client=client,create_if_missing=True,environment_name='main').hydrate()
    volume=sdk.Volume.from_name(config['resultsVolume'],client=client,create_if_missing=False,environment_name='main')
    if prior is None:
        with volume.batch_upload(force=False) as batch:batch.put_file(io.BytesIO(json.dumps({**config,'manifestFingerprint':manifest_fingerprint()},sort_keys=True).encode()),'deployment-claim.json')
    app,_=build_latentsync_app({k:v for k,v in config.items() if k!='appName'},sdk);app.deploy(name=config['appName'],client=client,environment_name='main');remote=sdk.Cls.from_name(config['appName'],'LatentSyncEngine',client=client,environment_name='main');remote.hydrate()
    attestation={**config,'appId':app.app_id,'classId':remote.object_id,'manifestFingerprint':manifest_fingerprint(),'modelRevision':manifest['revision'],'bundleFingerprint':bundle_fingerprint(),'runtimeVersion':'mashhad-latentsync-runtime-v1','imageDependencies':'requirements-gpu.lock','gpuStarted':False,'deploymentReady':True}
    with volume.batch_upload(force=True) as batch:batch.put_file(io.BytesIO(json.dumps(attestation,sort_keys=True).encode()),'deployment.json')
    return attestation


if __name__=='__main__':
    raise SystemExit('Use the authenticated explicit preparation bridge; no unattended CLI deployment.')
