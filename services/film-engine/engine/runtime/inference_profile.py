"""Pure, fail-closed profile selection. Never imports SDKs or downloads files.

The user selected DFR as the main successor. Its official comparison completed;
the persistent service adapter still needs an explicitly approved GPU test.
Conv is available only through an explicit historical rollback selection.
"""
import json
import os
from pathlib import Path

requested_profile=os.environ.get('LTX_INFERENCE_PROFILE') or 'dfr-main'
if requested_profile not in ('dfr-main','dfr-candidate','conv-stable'):
    raise RuntimeError('INVALID_LTX_INFERENCE_PROFILE')
INFERENCE_PROFILE='dfr-main' if requested_profile=='dfr-candidate' else requested_profile
PROFILE_MANIFEST=json.loads((Path(__file__).parent/(
    'conv-profile.json' if INFERENCE_PROFILE=='conv-stable' else 'production-profile.json'
)).read_text(encoding='utf-8'))
