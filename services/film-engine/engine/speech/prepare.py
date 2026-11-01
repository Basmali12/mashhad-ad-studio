"""Explicit CPU preparation only. This module never executes on import.

The injected default downloader is imported lazily after exact cost approval.
It operates inside the cloud-mounted Volume, never through HostHatch storage.
"""
import hashlib
import json
from pathlib import Path
import time
from .runtime import manifest_for,manifest_fingerprint,validate_scope
from .access import ACCESS_ERRORS,access_error,verify_component_access


def sha256_file(file):
    digest=hashlib.sha256()
    with Path(file).open('rb') as stream:
        while chunk:=stream.read(8*1024*1024):digest.update(chunk)
    return digest.hexdigest()


def prepare_models(request,*,model_dir,results_dir,engine_id,account_id,downloader=None,commit=lambda:None,access_metadata=None):
    if not isinstance(request,dict) or request.get('paidApproved') is not True:
        raise ValueError('SPEECH_PREPARATION_APPROVAL_REQUIRED')
    MODEL_ID=request.get('modelId');MANIFEST=manifest_for(MODEL_ID);MODEL_REVISION=MANIFEST['revision']
    if MODEL_ID=='audar-tts-v1-flash' and request.get('licenseAccepted') is not True:raise ValueError('SPEECH_LICENSE_ACCEPTANCE_REQUIRED')
    if MODEL_ID=='audar-tts-v1-flash' and request.get('codecLicenseAccepted') is not True:raise ValueError('SPEECH_CODEC_LICENSE_ACCEPTANCE_REQUIRED')
    if request.get('modelRevision')!=MODEL_REVISION or request.get('manifestFingerprint')!=manifest_fingerprint(MODEL_ID):
        raise ValueError('SPEECH_MANIFEST_MISMATCH')
    scope=validate_scope(request.get('scope'),engine_id,account_id,request_required=True)
    root=Path(model_dir);results=Path(results_dir)/'preparations';root.mkdir(parents=True,exist_ok=True,mode=0o700);results.mkdir(parents=True,exist_ok=True,mode=0o700)
    if root.is_symlink() or root.resolve()!=root.absolute() or results.is_symlink() or results.resolve()!=results.absolute():raise ValueError('SPEECH_UNSAFE_STORAGE')
    receipt=results/(scope['runId']+'.json');claim=results/(scope['runId']+'.claim')
    if claim.exists():
        if json.loads(claim.read_text(encoding='utf-8')).get('scope')!=scope:raise RuntimeError('SPEECH_PREPARATION_IDEMPOTENCY_CONFLICT')
        if receipt.is_file():return json.loads(receipt.read_text(encoding='utf-8'))
        raise RuntimeError('SPEECH_PREPARATION_STATE_UNKNOWN')
    with claim.open('x',encoding='utf-8') as stream:json.dump({'scope':scope,'manifestFingerprint':manifest_fingerprint(MODEL_ID)},stream)
    # Invalidate prior readiness before touching a previously corrupt file.
    (root/'READY.json').unlink(missing_ok=True)
    commit();started=time.monotonic();done=0;verified=[];access=[]
    def checkpoint(status,**extra):
        value={'scope':scope,'status':status,'modelId':MODEL_ID,'modelRevision':MODEL_REVISION,
               'manifestFingerprint':manifest_fingerprint(MODEL_ID),'ready':status=='completed',
               'completedBytes':done,'totalBytes':MANIFEST['totalBytes'],'completedFiles':len(verified),
               'totalFiles':len(MANIFEST['files']),'gpuUsed':False,**extra}
        temporary=receipt.with_suffix('.pending');temporary.write_text(json.dumps(value,sort_keys=True),encoding='utf-8');temporary.replace(receipt);commit();return value
    checkpoint('running',phase='inspection')
    try:
        if downloader is None:
            from huggingface_hub import hf_hub_download
            downloader=hf_hub_download
        import os
        for spec in MANIFEST['files']:
            file=root/spec['path']
            if file.is_symlink() or not file.resolve().is_relative_to(root.resolve()):raise ValueError('SPEECH_UNSAFE_STORAGE')
            valid=file.is_file() and file.stat().st_size==spec['size'] and sha256_file(file)==spec['sha256']
            if not valid:
                if spec.get('gated'):access.append(verify_component_access(spec,os.environ.get('HF_TOKEN'),metadata=access_metadata))
                checkpoint('running',phase='download',currentFile=spec['path'])
                # Source pins and destination mapping come only from this bundled manifest.
                repo=spec.get('repoId',MANIFEST['repoId']);revision=spec.get('revision',MODEL_REVISION);source=spec.get('sourcePath',spec['path'])
                incoming=root/'.incoming'/hashlib.sha256(repo.encode()).hexdigest()[:16]
                expected=incoming/source
                try:
                    resolved=Path(downloader(repo_id=repo,revision=revision,filename=source,local_dir=str(incoming),token=os.environ.get('HF_TOKEN') if spec.get('gated') else False,force_download=file.exists()))
                except Exception as error:
                    if spec.get('gated'):raise RuntimeError(access_error(error)) from None
                    raise
                if resolved.resolve()!=expected.resolve() or not resolved.resolve().is_relative_to(root.resolve()) or resolved.is_symlink() or not resolved.is_file() or resolved.stat().st_size!=spec['size'] or sha256_file(resolved)!=spec['sha256']:
                    raise RuntimeError('SPEECH_FILE_INTEGRITY_FAILED')
                file.parent.mkdir(parents=True,exist_ok=True);resolved.replace(file)
            verified.append({key:spec[key] for key in ('path','size','sha256')});done+=spec['size']
            checkpoint('running',phase='verification',currentFile=spec['path'])
        marker={'modelId':MODEL_ID,'revision':MODEL_REVISION,'manifestFingerprint':manifest_fingerprint(MODEL_ID),
                'engineId':engine_id,'accountId':account_id,'files':verified,'hashVerified':True,'componentAccess':access}
        temporary=root/'READY.pending.json';temporary.write_text(json.dumps(marker,sort_keys=True),encoding='utf-8');temporary.replace(root/'READY.json');commit()
        return checkpoint('completed',phase='ready',elapsedSeconds=time.monotonic()-started,cloudStopped=True)
    except BaseException as error:
        code=str(error) if type(error) is RuntimeError and str(error) in ACCESS_ERRORS else 'SPEECH_PREPARATION_FAILED'
        failure=checkpoint('failed',phase='failed',error=code,elapsedSeconds=time.monotonic()-started,cloudStopped=True)
        if code in ACCESS_ERRORS:return failure
        raise RuntimeError('SPEECH_PREPARATION_FAILED') from None
