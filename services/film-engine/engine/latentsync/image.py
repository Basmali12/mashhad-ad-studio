"""Lazy pinned image definitions; import never builds or creates resources."""
from pathlib import Path
ROOT=Path(__file__).resolve().parent
SOURCE_REVISION='a229c3948406bc2cf6eaf4873e662e70c6a04746'


def build_model_image(sdk=None):
    if sdk is None:import modal as sdk
    return (sdk.Image.debian_slim(python_version='3.10').apt_install('git','ffmpeg','libgl1','libglib2.0-0','build-essential')
            .pip_install_from_requirements(str(ROOT/'requirements-gpu.lock'))
            .run_commands('git clone https://github.com/bytedance/LatentSync.git /opt/latentsync-upstream','git -C /opt/latentsync-upstream checkout '+SOURCE_REVISION)
            .env({'PYTHONPATH':'/root:/opt/latentsync-upstream','HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1','HF_HUB_DISABLE_TELEMETRY':'1','TOKENIZERS_PARALLELISM':'false','TORCH_FORCE_WEIGHTS_ONLY_LOAD':'1'})
            .add_local_dir(ROOT,'/root/latentsync_runtime',ignore=['__pycache__','*.pyc']))


def build_preparation_image(sdk=None):
    if sdk is None:import modal as sdk
    return (sdk.Image.debian_slim(python_version='3.10').pip_install_from_requirements(str(ROOT/'requirements-cpu.lock')).env({'HF_HUB_DISABLE_TELEMETRY':'1'}).add_local_dir(ROOT,'/root/latentsync_runtime',ignore=['__pycache__','*.pyc']))
