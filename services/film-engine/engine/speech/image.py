"""Stable shared speech image factories; no model downloads/builds on import."""
from pathlib import Path
ROOT=Path(__file__).resolve().parent
AUDAR_SOURCE='8316d3f50e87f5622af3ecb78c1ef95261bff655'

def build_model_image(sdk=None):
    if sdk is None:import modal as sdk
    return (sdk.Image.debian_slim(python_version='3.12').apt_install('git','libsndfile1','ffmpeg')
            .pip_install_from_requirements(str(ROOT/'requirements-gpu.lock'))
            .run_commands('git clone https://github.com/AudarAI/Audar-TTS-V1.git /opt/audar', 'git -C /opt/audar checkout '+AUDAR_SOURCE)
            .env({'PYTHONPATH':'/root:/opt/audar','HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1','HF_HUB_DISABLE_TELEMETRY':'1','TOKENIZERS_PARALLELISM':'false'})
            .add_local_dir(ROOT,'/root/speech',ignore=['__pycache__','*.pyc']))

def build_preparation_image(sdk=None):
    if sdk is None:import modal as sdk
    return (sdk.Image.debian_slim(python_version='3.12').pip_install_from_requirements(str(ROOT/'requirements-cpu.lock'))
            .env({'HF_HUB_DISABLE_TELEMETRY':'1'}).add_local_dir(ROOT,'/root/speech',ignore=['__pycache__','*.pyc']))
