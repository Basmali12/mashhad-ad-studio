"""Explicit future CPU-only provisioning, never called at import or GPU start."""
import hashlib
import json
from pathlib import Path
from .lightwan_runtime import manifest, fingerprint
from .runtime import validate_scope


def prepare_lightwan(request, model_dir, *, engine_id, account_id, downloader=None):
    m = manifest()
    if request.get('paidApproved') is not True or request.get('manifestFingerprint') != fingerprint(m):
        raise ValueError('LIGHTWAN_PREPARATION_APPROVAL_REQUIRED')
    validate_scope(request.get('scope'), engine_id, account_id, request_required=True)
    root = Path(model_dir)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if root.is_symlink() or root.resolve() != root.absolute():
        raise ValueError('LIGHTWAN_UNSAFE_STORAGE')
    ready = root / 'LIGHTWAN_READY.json'
    if ready.is_symlink():
        raise ValueError('LIGHTWAN_UNSAFE_STORAGE')
    # Invalidate only this profile's readiness before re-verification.
    # A same-size corrupted file must not retain an old admission marker.
    if ready.exists():
        ready.unlink()
    if downloader is None:
        from huggingface_hub import hf_hub_download
        downloader = hf_hub_download
    verified = []
    for spec in m['files']:
        target = root / spec['path']
        if not target.resolve().is_relative_to(root.resolve()) or target.is_symlink():
            raise ValueError('LIGHTWAN_UNSAFE_STORAGE')
        if not target.exists():
            # Native repo layouts are isolated below base/ and lightwan/.
            prefix = spec['path'].split('/')[0]
            if spec['path'] != prefix + '/' + spec['remotePath']:
                raise ValueError('LIGHTWAN_LAYOUT_MISMATCH')
            resolved = Path(downloader(repo_id=spec['repoId'], revision=spec['revision'],
                                      filename=spec['remotePath'], local_dir=str(root / prefix),
                                      token=False))
            if resolved.resolve() != target.resolve():
                raise ValueError('LIGHTWAN_UNSAFE_STORAGE')
        if not target.is_file() or target.is_symlink() or target.stat().st_size != spec['size']:
            raise RuntimeError('LIGHTWAN_FILE_INTEGRITY_FAILED')
        digest = hashlib.sha256()
        with target.open('rb') as f:
            while chunk := f.read(8 * 1024 * 1024):
                digest.update(chunk)
        if digest.hexdigest() != spec['sha256']:
            raise RuntimeError('LIGHTWAN_FILE_INTEGRITY_FAILED')
        verified.append({k: spec[k] for k in ('path', 'size', 'sha256')})
    value = {'engineId': engine_id, 'accountId': account_id, 'hashVerified': True,
             'manifestFingerprint': fingerprint(m), 'files': verified,
             'executionProfile': 'accelerated', 'gpuUsed': False}
    pending = root / 'LIGHTWAN_READY.pending.json'
    if pending.is_symlink():
        raise ValueError('LIGHTWAN_UNSAFE_STORAGE')
    pending.write_text(json.dumps(value, sort_keys=True), encoding='utf-8')
    pending.replace(ready)
    return value
