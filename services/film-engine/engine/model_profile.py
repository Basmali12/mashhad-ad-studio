"""Model-neutral configuration. Importing it never touches a provider or builds an image."""
import json
import re
from pathlib import Path
ROOT=Path(__file__).resolve().parent
_PROFILE_FILE=ROOT/'model-profile.json'
MANIFEST=json.loads(_PROFILE_FILE.read_text(encoding='utf-8')) if _PROFILE_FILE.exists() else {
    'id':'unconfigured','model_repo':None,'model_revision':None,'source_commit':None,
    'files':{},'storage_prefix':None,'enabled':False}
INFERENCE_PROFILE=MANIFEST['id']
PREFIX=MANIFEST.get('storage_prefix') or '/unconfigured'


def require_model():
    if MANIFEST.get('enabled') is not True or not MANIFEST.get('files'):
        raise RuntimeError('ENGINE_NOT_CONFIGURED')
    if not re.fullmatch(r'[A-Za-z0-9_.-]{1,100}',MANIFEST.get('id','')):
        raise RuntimeError('INVALID_MODEL_PROFILE')
    prefix=MANIFEST.get('storage_prefix')
    if not isinstance(prefix,str) or not prefix.startswith('/') or '..' in prefix.split('/') or prefix in ('/','/unconfigured'):
        raise RuntimeError('INVALID_MODEL_PROFILE')
    if not isinstance(MANIFEST.get('model_revision'),str) or not MANIFEST['model_revision']:
        raise RuntimeError('INVALID_MODEL_PROFILE')
    for name,spec in MANIFEST['files'].items():
        if not isinstance(name,str) or not re.fullmatch(r'[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*',name) or any(part in ('.','..') for part in name.split('/')):
            raise RuntimeError('INVALID_MODEL_FILE')
        if not isinstance(spec,dict) or type(spec.get('size')) is not int or spec['size']<=0 or not re.fullmatch(r'[a-f0-9]{64}',spec.get('sha256','')):
            raise RuntimeError('INVALID_MODEL_FILE')
    return MANIFEST
