"""Pure cross-language transfer identity. No SDK, network or model access."""
import hashlib
import json

def fingerprint(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()

def manifest_identity(manifest):
    return {'manifestId':manifest['id'],'manifestFingerprint':fingerprint(manifest)} if 'id' in manifest else {}

def runtime_metadata(manifest):
    dfr=manifest.get('pipeline')=='DFRPipeline'
    return {'model_revision':manifest['model_revision'],'source_commit':manifest['source_commit'],
            **manifest_identity(manifest),'native_audio':True,'vae':'diffusion' if dfr else 'conv',
            'pipeline':manifest.get('pipeline','DistilledPipeline'),
            'profile':'dfr-main' if dfr else 'conv-stable',
            'gpu_choices':['RTX-PRO-6000'] if dfr else ['RTX-PRO-6000','L40S'],
            'torch':'2.9.1+cu128','cuda':'12.8','precision':'FP8 cast / BF16 compute','offload':'cpu'}
