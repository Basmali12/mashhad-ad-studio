"""Explicit licensed/approved cloud CPU preparation. No imports download weights."""
import hashlib
import json
from pathlib import Path,PurePosixPath
import shutil
import time
import urllib.request
import zipfile
from .runtime import manifest_for,manifest_fingerprint,validate_scope


def file_hash(path):
    digest=hashlib.sha256()
    with Path(path).open('rb') as stream:
        while data:=stream.read(8*1024*1024):digest.update(data)
    return digest.hexdigest()


def extract_faces(root):
    target=root/'face/extracted';target.mkdir(parents=True,exist_ok=True,mode=0o700)
    if target.is_symlink() or target.resolve()!=target.absolute():raise ValueError('LATENTSYNC_UNSAFE_STORAGE')
    rows=[]
    with zipfile.ZipFile(root/'face/buffalo_m.zip') as archive:
        selected=[]
        for item in archive.infolist():
            p=PurePosixPath(item.filename)
            if p.is_absolute() or '..' in p.parts or '\\' in item.filename:raise ValueError('LATENTSYNC_UNSAFE_ARCHIVE')
            if p.name=='2d106det.onnx' or p.name.startswith('det_') and p.name.endswith('.onnx'):selected.append((item,p.name))
        if len(selected)!=2 or len({name for _,name in selected})!=2 or not any(name=='2d106det.onnx' for _,name in selected):raise RuntimeError('LATENTSYNC_FACE_ARCHIVE_UNSUPPORTED')
        for item,name in selected:
            if not 0<item.file_size<=64*1024*1024 or item.external_attr>>16&0o170000==0o120000:raise ValueError('LATENTSYNC_UNSAFE_ARCHIVE')
            path=target/name
            if path.is_symlink():raise ValueError('LATENTSYNC_UNSAFE_STORAGE')
            with archive.open(item) as src,path.open('wb') as dst:shutil.copyfileobj(src,dst,1024*1024)
            rows.append({'path':'face/extracted/'+name,'size':path.stat().st_size,'sha256':file_hash(path)})
    return rows


def download_spec(spec,destination):
    """Only fixed manifest sources. Called exclusively inside approved CPU job."""
    if spec.get('repoId'):
        from huggingface_hub import hf_hub_download
        cache=destination.parent/'.hf-cache';source=Path(hf_hub_download(repo_id=spec['repoId'],filename=spec['filename'],revision=spec['revision'],local_dir=str(cache)))
        with source.open('rb') as src,destination.open('wb') as dst:shutil.copyfileobj(src,dst,8*1024*1024)
        source.unlink()
    else:
        with urllib.request.urlopen(spec['url'],timeout=120) as src,destination.open('wb') as dst:shutil.copyfileobj(src,dst,8*1024*1024)


def prepare_models(request,*,model_dir,results_dir,engine_id,account_id,downloader=None,commit=lambda:None):
    if not isinstance(request,dict) or request.get('paidApproved') is not True:raise ValueError('LATENTSYNC_PREPARATION_APPROVAL_REQUIRED')
    # A non-commercial grant is not converted into commercial permission by an
    # acknowledgement checkbox. The server must hold a separately verified grant.
    if request.get('usageMode')!='noncommercial_research' or request.get('researchOnly') is not True:raise ValueError('LATENTSYNC_COMMERCIAL_RIGHTS_REQUIRED')
    if request.get('licenseAccepted') is not True or request.get('faceModelRightsApproved') is not True or not isinstance(request.get('rightsEvidence'),str) or not 8<=len(request['rightsEvidence'].strip())<=1000:raise ValueError('LATENTSYNC_COMMERCIAL_RIGHTS_REQUIRED')
    manifest=manifest_for()
    if request.get('modelId')!='latentsync16' or request.get('modelRevision')!=manifest['revision'] or request.get('manifestFingerprint')!=manifest_fingerprint():raise ValueError('LATENTSYNC_MANIFEST_MISMATCH')
    scope=validate_scope(request.get('scope'),engine_id,account_id,request_required=True);root=Path(model_dir);results=Path(results_dir)/'preparations'
    for p in (root,results):
        p.mkdir(parents=True,exist_ok=True,mode=0o700)
        if p.is_symlink() or p.resolve()!=p.absolute():raise ValueError('LATENTSYNC_UNSAFE_STORAGE')
    receipt=results/(scope['runId']+'.json');claim=results/(scope['runId']+'.claim')
    if claim.exists():
        value=json.loads(claim.read_text(encoding='utf-8'))
        if value.get('scope')!=scope:raise RuntimeError('LATENTSYNC_PREPARATION_IDEMPOTENCY_CONFLICT')
        if receipt.is_file():return json.loads(receipt.read_text(encoding='utf-8'))
        raise RuntimeError('LATENTSYNC_PREPARATION_STATE_UNKNOWN')
    with claim.open('x',encoding='utf-8') as stream:json.dump({'scope':scope,'manifestFingerprint':manifest_fingerprint()},stream)
    (root/'READY.json').unlink(missing_ok=True);commit();done=0;verified=[];started=time.monotonic()
    def checkpoint(status,**extra):
        value={'scope':scope,'status':status,'modelId':'latentsync16','modelRevision':manifest['revision'],'manifestFingerprint':manifest_fingerprint(),'ready':status=='completed','gpuUsed':False,'completedBytes':done,'totalBytes':manifest['totalBytes'],'completedFiles':len(verified),'totalFiles':len(manifest['files']),**extra};temp=receipt.with_suffix('.pending');temp.write_text(json.dumps(value,sort_keys=True),encoding='utf-8');temp.replace(receipt);commit();return value
    checkpoint('running');download=downloader or download_spec
    try:
        for spec in manifest['files']:
            path=root/spec['path'];path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
            if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):raise ValueError('LATENTSYNC_UNSAFE_STORAGE')
            if not path.is_file() or path.stat().st_size!=spec['size'] or file_hash(path)!=spec['sha256']:
                partial=path.with_name(path.name+'.partial')
                if partial.is_symlink():raise ValueError('LATENTSYNC_UNSAFE_STORAGE')
                download(spec,partial)
                if not partial.is_file() or partial.stat().st_size!=spec['size'] or file_hash(partial)!=spec['sha256']:raise RuntimeError('LATENTSYNC_WEIGHT_HASH_MISMATCH')
                partial.replace(path)
            verified.append({k:spec[k] for k in ('path','size','sha256')});done+=spec['size'];checkpoint('running')
        face_files=extract_faces(root);marker={'modelId':'latentsync16','revision':manifest['revision'],'manifestFingerprint':manifest_fingerprint(),'engineId':engine_id,'accountId':account_id,'files':verified,'faceFiles':face_files,'licenses':{'usageMode':'noncommercial_research','researchOnly':True,'licenseAccepted':True,'faceModelRightsApproved':True,'rightsEvidence':request['rightsEvidence']},'preparedAt':time.time()}
        temp=root/'READY.pending';temp.write_text(json.dumps(marker,sort_keys=True),encoding='utf-8');temp.replace(root/'READY.json');commit();return checkpoint('completed',elapsedSeconds=time.monotonic()-started)
    except BaseException:
        (root/'READY.json').unlink(missing_ok=True);checkpoint('failed',error='LATENTSYNC_PREPARATION_FAILED_NO_RETRY');raise RuntimeError('LATENTSYNC_PREPARATION_FAILED_NO_RETRY') from None
