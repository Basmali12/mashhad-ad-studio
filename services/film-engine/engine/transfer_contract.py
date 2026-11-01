"""Pinned transfer identity; importing this module performs no cloud operations."""
import json
from pathlib import Path
from model_profile import INFERENCE_PROFILE, MANIFEST, PREFIX, require_model
from transfer_identity import fingerprint,manifest_identity
ROOT=Path(__file__).resolve().parent
VERSION='cloud-copy-v5-model-bound'
APP_NAME='mashhad-model-cloud-copy-v1'
DICT_NAME='mashhad-model-cloud-copy-state-v1'
FUNCTION_NAME='copy_models'
SOURCE_WORKSPACE='basm1998ali'
SOURCE_VOLUME=MANIFEST.get('source_volume') or 'mashhad-model-source'
CPU=2;RAM_MIB=4096;TIMEOUT=3600;STARTUP=180
VERIFY_TIMEOUT=600
def verifier_names(volume):
    import re
    if not re.fullmatch(r'mashhad-model-[a-f0-9]{8}',volume):raise ValueError('INVALID_TRANSFER_DESTINATION')
    suffix=volume[-8:]
    return 'mashhad-model-verify-'+suffix,'mashhad-model-verify-state-'+suffix
IDENTITY={'profile':INFERENCE_PROFILE,**manifest_identity(MANIFEST)}
FINGERPRINT=fingerprint({'version':VERSION,'profile':INFERENCE_PROFILE,'manifestFingerprint':IDENTITY['manifestFingerprint'],'cpu':CPU,'ram':RAM_MIB,'timeout':TIMEOUT,'verifyTimeout':VERIFY_TIMEOUT,'source':SOURCE_VOLUME})

def plan_scope(files,mode,volume):
    return {**IDENTITY,'workerFingerprint':FINGERPRINT,'sourceVolume':SOURCE_VOLUME,
            'destinationVolume':volume,'mode':mode,
            'files':sorted([{'name':n,'size':MANIFEST['files'][n]['size'],'sha256':MANIFEST['files'][n]['sha256']} for n in files],key=lambda f:f['name'])}

def validate_plan(plan,volume):
    require_model()
    import re
    if not isinstance(volume,str) or not re.fullmatch(r'mashhad-model-[a-f0-9]{8}',volume):raise ValueError('TRANSFER_PLAN_CHANGED_REQUOTE')
    if any(plan.get(k)!=v for k,v in IDENTITY.items()) or plan.get('workerFingerprint')!=FINGERPRINT:
        raise ValueError('TRANSFER_PROFILE_CHANGED_REQUOTE')
    mode=plan.get('mode');rows=plan.get('files')
    if mode not in ('full','probe','verify-only') or not isinstance(rows,list):raise ValueError('TRANSFER_PLAN_CHANGED_REQUOTE')
    names=[]
    for row in rows:
        name=row.get('name');spec=MANIFEST['files'].get(name)
        if not spec or name in names or (row.get('size'),row.get('sha256'))!=(spec['size'],spec['sha256']):raise ValueError('TRANSFER_PLAN_CHANGED_REQUOTE')
        names.append(name)
    if mode!='full' and names:raise ValueError('TRANSFER_PLAN_CHANGED_REQUOTE')
    required=65536 if mode=='probe' else sum(MANIFEST['files'][n]['size'] for n in names)
    if plan.get('requiredBytes')!=required or plan.get('sourceVolume')!=SOURCE_VOLUME or plan.get('destinationVolume')!=volume or plan.get('transferPlanFingerprint')!=fingerprint(plan_scope(names,mode,volume)):
        raise ValueError('TRANSFER_PLAN_CHANGED_REQUOTE')
    return names

def validate_request(request):
    require_model()
    names=request.get('files');mode=request.get('mode');volume=request.get('volume')
    if not isinstance(names,list) or len(set(names))!=len(names) or not set(names).issubset(MANIFEST['files']) or mode not in ('full','probe','verify-only') or (mode!='full' and names):raise ValueError('TRANSFER_PLAN_CHANGED_REQUOTE')
    if request.get('fingerprint')!=FINGERPRINT or any(request.get(k)!=v for k,v in IDENTITY.items()) or request.get('transferPlanFingerprint')!=fingerprint(plan_scope(names,mode,volume)):
        raise ValueError('TRANSFER_PROFILE_CHANGED_REQUOTE')
    return True

def add_profile_files(image):
    # Static deployment selection only; no job/credential/payload enters the image.
    require_model()
    for name in ('transfer_identity.py','model_profile.py','model-profile.json'):
        image=image.add_local_file(ROOT/name,'/root/'+name)
    return image
