"""Private primary-account audition factory. Importing creates no resources.

No deployment, public endpoint, rental change or automatic retry. Caller must
verify account/budget and run an independent stop watcher before app.run().
"""
from pathlib import Path
import hashlib
import json
import time
from .runtime import manifest

ROOT=Path(__file__).resolve().parent
VOLUME='mashhad-models-a14d9684bfd7'
PREFIX='/models/private-three-arab-audioseal-v1'
APP='mashhad-three-arab-private-audioseal-1'

def trial_directory(child,mount='/models'):
 if child not in ('assets','trial1','trial2'):raise ValueError('TRIAL_PATH_INVALID')
 # Modal's mount itself is a provider-managed symlink. Canonicalize that
 # trusted boundary, while rejecting symlinks in our owned child namespace.
 base=Path(mount).resolve(strict=True);namespace=base/'private-three-arab-audioseal-v1'
 target=namespace/child
 if namespace.is_symlink() or target.is_symlink() or not target.resolve().is_relative_to(base):
  raise RuntimeError('THREE_ARAB_UNSAFE_TRIAL_PATH')
 return target

def build_image(sdk):
 m=manifest()
 return (sdk.Image.debian_slim(python_version='3.11')
  .apt_install('git','ffmpeg','libsndfile1','build-essential')
  .pip_install('uv==0.13.6')
  .add_local_file(ROOT/'build_lock.py','/opt/repair_three_arab_lock.py',copy=True)
  .run_commands('git clone https://github.com/sherif1313/3arab-TTS.git /opt/three-arab',
    'git -C /opt/three-arab checkout '+m['sourceCommit'],
    'python /opt/repair_three_arab_lock.py /opt/three-arab/uv.lock',
    'cd /opt/three-arab && uv sync --frozen --no-dev --extra cu128',
    'git clone https://github.com/facebookresearch/audioseal.git /opt/audioseal',
    'git -C /opt/audioseal checkout '+m['watermarkSourceCommit'],
    'uv pip install --python /opt/three-arab/.venv/bin/python --no-deps -e /opt/audioseal',
    'uv pip install --python /opt/three-arab/.venv/bin/python --no-deps omegaconf==2.3.0 antlr4-python3-runtime==4.9.3')
  .env({'PYTHONPATH':'/root',
    'HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1','HF_HUB_DISABLE_TELEMETRY':'1','WANDB_DISABLED':'true','USER':'root','OMP_NUM_THREADS':'2','MKL_NUM_THREADS':'2','OPENBLAS_NUM_THREADS':'2'})
  .add_local_file((ROOT.parents[3]/'../../work/msa-majestic-single1/msa-narrator-native.wav').resolve(),'/root/fixtures/owner-synthetic-narration.wav')
  .add_local_dir(ROOT,'/root/three_arab',ignore=['__pycache__','*.pyc']))

def prepare():
 import modal
 from huggingface_hub import hf_hub_download
 from .runtime import verify_files
 root=trial_directory('assets');root.mkdir(parents=True,exist_ok=True)
 started=time.monotonic()
 for f in manifest()['files']:
  target=root/f['path'];target.parent.mkdir(parents=True,exist_ok=True)
  if target.is_file() and target.stat().st_size==f['size']:
   h=hashlib.sha256()
   with target.open('rb') as stream:
    for b in iter(lambda:stream.read(1024*1024),b''):h.update(b)
   if h.hexdigest()==f['sha256']:continue
  cache=hf_hub_download(repo_id=f['repoId'],filename=f['sourcePath'],revision=f['revision'],local_dir='/tmp/three-arab-download')
  partial=target.with_suffix(target.suffix+'.partial')
  import shutil
  shutil.copyfile(cache,partial)
  if partial.stat().st_size!=f['size']:raise RuntimeError('THREE_ARAB_DOWNLOAD_SIZE_CHANGED')
  h=hashlib.sha256()
  with partial.open('rb') as stream:
   for b in iter(lambda:stream.read(1024*1024),b''):h.update(b)
  if h.hexdigest()!=f['sha256']:raise RuntimeError('THREE_ARAB_DOWNLOAD_HASH_CHANGED')
  partial.replace(target)
  modal.Volume.from_name(VOLUME,create_if_missing=False).commit()
  print(json.dumps({'phase':'prepared_file','path':f['path'],'bytes':f['size']}),flush=True)
 checked=verify_files(root)
 modal.Volume.from_name(VOLUME,create_if_missing=False).commit()
 return {**checked,'prepareSeconds':time.monotonic()-started}

def native_command(mode,*args,timeout):
 import subprocess,os
 env={**os.environ,'PYTHONPATH':'/root:/opt/three-arab:/opt/audioseal/src'}
 result=subprocess.run(['/opt/three-arab/.venv/bin/python','-m','three_arab.worker',mode,*map(str,args)],env=env,capture_output=True,text=True,timeout=timeout)
 if result.stdout:print(result.stdout,flush=True)
 if result.stderr:print(result.stderr,flush=True)
 return result

def native_preflight():
 result=native_command('inspect',trial_directory('assets'),timeout=90)
 if result.returncode:raise RuntimeError('THREE_ARAB_CPU_PREFLIGHT_FAILED')
 prefix='MASHHAD_NATIVE_RESULT:'
 rows=[json.loads(line[len(prefix):]) for line in result.stdout.splitlines() if line.startswith(prefix)]
 if len(rows)!=1 or not rows[0].get('imports'):raise RuntimeError('THREE_ARAB_CPU_RECEIPT_INVALID')
 return rows[0]

def audition(requests):
 import modal,subprocess
 from .runtime import validate_request
 if not isinstance(requests,list) or len(requests)!=2 or [r.get('style') for r in requests]!=['solemn','calm']:
  raise ValueError('THREE_ARAB_TRIAL_SCOPE_INVALID')
 for r in requests:validate_request(r)
 if requests[0]['text']!=requests[1]['text']:raise ValueError('THREE_ARAB_COMPARISON_TEXT_CHANGED')
 volume=modal.Volume.from_name(VOLUME,create_if_missing=False)
 out=trial_directory('trial2');out.mkdir(parents=True,exist_ok=True)
 for r in requests:
  with (out/('trial2-'+r['style']+'.cloud-claim')).open('x') as stream:
   stream.write(hashlib.sha256(json.dumps(r,sort_keys=True,ensure_ascii=False).encode()).hexdigest())
 request_file=out/'requests.json'
 with request_file.open('x',encoding='utf-8') as stream:json.dump(requests,stream,ensure_ascii=False)
 volume.commit();failure=None
 try:
  result=native_command('batch',trial_directory('assets'),request_file,timeout=150)
  if result.returncode:failure='NativeWorkerFailed'
 except subprocess.TimeoutExpired:failure='NativeWorkerTimeout'
 finally:volume.commit()
 samples=[]
 for r in requests:
  name='trial2-'+r['style'];receipt=out/(name+'.json');wav=out/(name+'.wav')
  if receipt.is_file() and wav.is_file():
   row=json.loads(receipt.read_text(encoding='utf-8'));raw=wav.read_bytes()
   if hashlib.sha256(raw).hexdigest()!=row['result']['sha256']:raise RuntimeError('THREE_ARAB_RESULT_CHANGED')
   samples.append({'receipt':row,'wavBytes':raw,'sourceFloatBytes':Path(row['result']['sourceFile']).read_bytes()})
 return {'samples':samples,'failureType':failure,'automaticRetry':False}

def build_trial(sdk=None):
 if sdk is None:import modal as sdk
 volume=sdk.Volume.from_name(VOLUME,create_if_missing=False)
 app=sdk.App(APP)
 cpu=(sdk.Image.debian_slim(python_version='3.11').pip_install('huggingface-hub==0.34.0')
   .env({'HF_HUB_DISABLE_TELEMETRY':'1'}).add_local_dir(ROOT,'/root/three_arab',ignore=['__pycache__','*.pyc']))
 preparation=app.function(image=cpu,volumes={'/models':volume},cpu=2,memory=4096,timeout=600,retries=0)(prepare)
 image=build_image(sdk)
 inspection=app.function(image=image,volumes={'/models':volume},cpu=2,memory=16384,timeout=120,retries=0)(native_preflight)
 generation=app.function(image=image,volumes={'/models':volume},gpu='L40S',cpu=2,memory=16384,timeout=180,startup_timeout=180,retries=0,max_containers=1)(audition)
 return app,preparation,inspection,generation
