"""Safe, explicit gated-component checks inside approved CPU preparation only.

No network or secret reads on import. A Modal Secret's existence is not proof
that Hugging Face accepted its token or the publisher's access conditions.
"""
import re

ACCESS_ERRORS = frozenset({
    'SPEECH_CODEC_AUTHORIZATION_REQUIRED', 'SPEECH_COMPONENT_ACCESS_DENIED',
    'SPEECH_COMPONENT_NOT_FOUND', 'SPEECH_COMPONENT_ACCESS_UNAVAILABLE',
})


def access_error(error):
    """Classify status/type only. Never stringify an HTTP error containing secrets."""
    status = getattr(getattr(error, 'response', None), 'status_code', None)
    name = type(error).__name__
    if status == 401:
        return 'SPEECH_CODEC_AUTHORIZATION_REQUIRED'
    if status == 403 or name == 'GatedRepoError':
        return 'SPEECH_COMPONENT_ACCESS_DENIED'
    if status == 404 or name in ('EntryNotFoundError', 'RevisionNotFoundError', 'RepositoryNotFoundError'):
        return 'SPEECH_COMPONENT_NOT_FOUND'
    return 'SPEECH_COMPONENT_ACCESS_UNAVAILABLE'


def verify_component_access(spec, token, *, metadata=None):
    """HEAD the exact pinned file, not weights; return scoped non-secret evidence.

    Only called for a missing gated component, after preparation cost approval.
    HF consent is enforced by HF itself, not bypassed or inferred from a flag.
    """
    if not isinstance(token, str) or not token.strip():
        raise RuntimeError('SPEECH_CODEC_AUTHORIZATION_REQUIRED')
    repo, revision, filename = spec.get('repoId'), spec.get('revision'), spec.get('sourcePath')
    if not isinstance(repo, str) or not re.fullmatch(r'[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+', repo) or not isinstance(revision, str) or not re.fullmatch(r'[a-f0-9]{40}', revision) or not isinstance(filename, str) or filename.startswith('/') or any(p in ('', '.', '..') for p in filename.split('/')):
        raise ValueError('SPEECH_MANIFEST_MISMATCH')
    if metadata is None:
        from huggingface_hub import get_hf_file_metadata
        metadata = get_hf_file_metadata
    from urllib.parse import quote
    url = 'https://huggingface.co/' + repo + '/resolve/' + revision + '/' + quote(filename, safe='/')
    try:
        result = metadata(url, token=token, timeout=20)
    except Exception as error:
        raise RuntimeError(access_error(error)) from None
    if getattr(result, 'size', None) != spec['size'] or getattr(result, 'commit_hash', None) != revision:
        raise RuntimeError('SPEECH_COMPONENT_NOT_FOUND')
    return {'repoId': repo, 'revision': revision, 'sourcePath': filename, 'status': 'authorized', 'method': 'authenticated_pinned_file_metadata'}
