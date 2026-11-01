"""Pure cross-language transfer identity. No SDK, network or model access."""
import hashlib
import json

def fingerprint(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()

def manifest_identity(manifest):
    return {'manifestId':manifest['id'],'manifestFingerprint':fingerprint(manifest)} if 'id' in manifest else {}

def runtime_metadata(manifest):
    # Prepared files describe storage readiness, never GPU/model execution proof.
    return {'model_revision':manifest['model_revision'],'source_commit':manifest.get('source_commit'),
            **manifest_identity(manifest),'profile':manifest.get('id','unconfigured'),
            'runtime':manifest.get('runtime',{}),'generationValidated':False}
