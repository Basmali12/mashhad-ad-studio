"""Explicit CPU preparation only. This module never executes on import.

The injected default downloader is imported lazily after exact cost approval.
It operates inside the cloud-mounted Volume, never through HostHatch storage.
"""
import hashlib
import json
from pathlib import Path
import time
from .runtime import MANIFEST,MODEL_ID,MODEL_REVISION,manifest_fingerprint,validate_scope


def sha256_file(file):
    digest=hashlib.sha256()
    with Path(file).open('rb') as stream:
        while chunk:=stream.read(8*1024*1024):digest.update(chunk)
    return digest.hexdigest()


def prepare_models(request,*,model_dir,results_dir,engine_id,account_id,downloader=None,commit=lambda:None):
    if not isinstance(request,dict) or request.get('paidApproved') is not True:
        raise ValueError('WAN_PREPARATION_APPROVAL_REQUIRED')
    if request.get('modelRevision')!=MODEL_REVISION or request.get('manifestFingerprint')!=manifest_fingerprint():
        raise ValueError('WAN_MANIFEST_MISMATCH')
    scope=validate_scope(request.get('scope'),engine_id,account_id,request_required=True)
    root=Path(model_dir);results=Path(results_dir)/'preparations';root.mkdir(parents=True,exist_ok=True,mode=0o700);results.mkdir(parents=True,exist_ok=True,mode=0o700)
    if root.is_symlink() or root.resolve()!=root.absolute() or results.is_symlink() or results.resolve()!=results.absolute():raise ValueError('WAN_UNSAFE_STORAGE')
    receipt=results/(scope['runId']+'.json');claim=results/(scope['runId']+'.claim')
    if claim.exists():
        if json.loads(claim.read_text(encoding='utf-8')).get('scope')!=scope:raise RuntimeError('WAN_PREPARATION_IDEMPOTENCY_CONFLICT')
        if receipt.is_file():return json.loads(receipt.read_text(encoding='utf-8'))
        raise RuntimeError('WAN_PREPARATION_STATE_UNKNOWN')
    with claim.open('x',encoding='utf-8') as stream:json.dump({'scope':scope,'manifestFingerprint':manifest_fingerprint()},stream)
    # Invalidate prior readiness before touching a previously corrupt file.
    (root/'READY.json').unlink(missing_ok=True)
    commit();started=time.monotonic();done=0;verified=[]
    def checkpoint(status,**extra):
        value={'scope':scope,'status':status,'modelId':MODEL_ID,'modelRevision':MODEL_REVISION,
               'manifestFingerprint':manifest_fingerprint(),'ready':status=='completed',
               'completedBytes':done,'totalBytes':MANIFEST['totalBytes'],'completedFiles':len(verified),
               'totalFiles':len(MANIFEST['files']),'gpuUsed':False,**extra}
        temporary=receipt.with_suffix('.pending');temporary.write_text(json.dumps(value,sort_keys=True),encoding='utf-8');temporary.replace(receipt);commit();return value
    checkpoint('running',phase='inspection')
    try:
        if downloader is None:
            from huggingface_hub import hf_hub_download
            downloader=hf_hub_download
        for spec in MANIFEST['files']:
            file=root/spec['path']
            if file.is_symlink() or not file.resolve().is_relative_to(root.resolve()):raise ValueError('WAN_UNSAFE_STORAGE')
            valid=file.is_file() and file.stat().st_size==spec['size'] and sha256_file(file)==spec['sha256']
            if not valid:
                checkpoint('running',phase='download',currentFile=spec['path'])
                resolved=Path(downloader(repo_id=MANIFEST['repoId'],revision=MODEL_REVISION,
                    filename=spec['path'],local_dir=str(root),token=False,force_download=file.exists()))
                if resolved.resolve()!=file.resolve() or not file.is_file() or file.is_symlink() or file.stat().st_size!=spec['size'] or sha256_file(file)!=spec['sha256']:
                    raise RuntimeError('WAN_FILE_INTEGRITY_FAILED')
            verified.append({key:spec[key] for key in ('path','size','sha256')});done+=spec['size']
            checkpoint('running',phase='verification',currentFile=spec['path'])
        marker={'modelId':MODEL_ID,'revision':MODEL_REVISION,'manifestFingerprint':manifest_fingerprint(),
                'engineId':engine_id,'accountId':account_id,'files':verified,'hashVerified':True}
        temporary=root/'READY.pending.json';temporary.write_text(json.dumps(marker,sort_keys=True),encoding='utf-8');temporary.replace(root/'READY.json');commit()
        return checkpoint('completed',phase='ready',elapsedSeconds=time.monotonic()-started,cloudStopped=True)
    except BaseException:
        checkpoint('failed',phase='failed',error='WAN_PREPARATION_FAILED',elapsedSeconds=time.monotonic()-started)
        raise RuntimeError('WAN_PREPARATION_FAILED') from None
