"""Stable cacheable image factories. Importing this module does not import Modal.

Calling a factory only defines an Image locally; no resolve/build/deploy here.
Job IDs, credentials, prompts, engine definitions and seeds never enter images.
"""
from pathlib import Path

ROOT=Path(__file__).resolve().parent


def build_model_image(sdk=None):
    if sdk is None:import modal as sdk
    return (sdk.Image.debian_slim(python_version='3.12')
            .pip_install_from_requirements(str(ROOT/'requirements-gpu.lock'))
            .env({'HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1','DIFFUSERS_OFFLINE':'1',
                  'HF_HUB_DISABLE_TELEMETRY':'1','TOKENIZERS_PARALLELISM':'false'})
            .add_local_dir(ROOT,'/root/flux',ignore=['__pycache__','*.pyc']))


def build_preparation_image(sdk=None):
    if sdk is None:import modal as sdk
    return (sdk.Image.debian_slim(python_version='3.12')
            .pip_install_from_requirements(str(ROOT/'requirements-cpu.lock'))
            .env({'HF_HUB_DISABLE_TELEMETRY':'1'})
            .add_local_dir(ROOT,'/root/flux',ignore=['__pycache__','*.pyc']))
