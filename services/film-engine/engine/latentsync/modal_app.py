"""Definitions only: no app.run/deploy/spawn or creation at import time."""
import hashlib
import importlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import modal
from .runtime import LatentSyncRuntime,manifest_for,manifest_fingerprint,validate_scope,validate_request
from .image import build_model_image,build_preparation_image

ROOT=Path(__file__).resolve().parent
ENV='MASHHAD_LATENTSYNC_DEPLOYMENT'
UUID=re.compile(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')
NAME=re.compile(r'^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$')


def deployment_config(config):
    required={'modelId','engineId','accountId','modelVolume','resultsVolume','weightPath','gpu','cpu','ramGiB'}
    if not isinstance(config,dict) or not required.issubset(config) or set(config)-required-{'timeout','startupTimeout','idleSeconds'}:raise ValueError('LATENTSYNC_INVALID_DEPLOYMENT')
    if config.get('modelId')!='latentsync16' or not UUID.fullmatch(config.get('engineId','')) or not NAME.fullmatch(config.get('accountId','')) or not NAME.fullmatch(config.get('modelVolume','')) or config.get('weightPath')!='models/latentsync16/'+config['engineId']:raise ValueError('LATENTSYNC_INVALID_DEPLOYMENT')
    expected='mashhad-latentsync-results-'+hashlib.sha256(config['engineId'].encode()).hexdigest()[:16]
    if config.get('resultsVolume')!=expected or config['modelVolume']==config['resultsVolume'] or config.get('gpu')!='L40S' or type(config.get('cpu')) is not int or config['cpu']!=4 or type(config.get('ramGiB')) is not int or config['ramGiB']!=32:raise ValueError('LATENTSYNC_INVALID_DEPLOYMENT')
    result={**config,'appName':'mashhad-latentsync-'+config['engineId'].replace('-','')[:12],'timeout':config.get('timeout',600),'startupTimeout':config.get('startupTimeout',180),'idleSeconds':config.get('idleSeconds',1200)}
    for key,low,high in [('timeout',60,3600),('startupTimeout',60,1800),('idleSeconds',2,1200)]:
        if type(result[key]) is not int or not low<=result[key]<=high:raise ValueError('LATENTSYNC_INVALID_DEPLOYMENT')
    return result


def prepare_models(request):
    config=deployment_config(json.loads(os.environ[ENV]));weights=modal.Volume.from_name(config['modelVolume'],create_if_missing=False);results=modal.Volume.from_name(config['resultsVolume'],create_if_missing=False)
    if any(request.get(k)!=config[k] for k in ('modelId','modelVolume','resultsVolume','weightPath')):raise ValueError('LATENTSYNC_SCOPE_MISMATCH')
    from latentsync_runtime.prepare import prepare_models as prepare
    def commit():weights.commit();results.commit()
    return prepare(request,model_dir=Path('/models')/config['weightPath'],results_dir='/results',engine_id=config['engineId'],account_id=config['accountId'],commit=commit)


class LatentSyncEngine:
    runtime_id:str=modal.parameter()

    @modal.enter()
    def initialize(self):
        self.config=deployment_config(json.loads(os.environ[ENV]));self.manifest=manifest_for();self.results=modal.Volume.from_name(self.config['resultsVolume'],create_if_missing=False);self.runtime=LatentSyncRuntime(Path('/models')/self.config['weightPath'],expected_scope={'engineId':self.config['engineId'],'accountId':self.config['accountId']})

    @modal.method()
    def start(self,scope):
        validate_scope(scope,self.config['engineId'],self.config['accountId'],self.runtime_id);ready=self.runtime.prepare();folder=Path('/results')/'runs'/self.runtime_id;folder.mkdir(parents=True,exist_ok=True,mode=0o700);(folder/'start.json').write_text(json.dumps({'scope':scope,'ready':True,'modelRevision':self.manifest['revision'],'manifestFingerprint':manifest_fingerprint()}),encoding='utf-8');self.results.commit();return {'engineId':self.config['engineId'],'accountId':self.config['accountId'],'runId':self.runtime_id,'ready':True,'modelId':'latentsync16','modelRevision':self.manifest['revision'],'manifestFingerprint':manifest_fingerprint(),'loadSeconds':ready['loadSeconds'],'runtimeLoaded':False}

    @modal.method()
    def generate(self,request,scope):
        validate_scope(scope,self.config['engineId'],self.config['accountId'],self.runtime_id,request_required=True);checked=validate_request(request);fingerprint=hashlib.sha256(json.dumps({k:hashlib.sha256(v).hexdigest() if isinstance(v,bytes) else v for k,v in checked.items()},sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest();folder=Path('/results')/'runs'/self.runtime_id/'results';folder.mkdir(parents=True,exist_ok=True,mode=0o700)
        if folder.is_symlink() or folder.resolve()!=folder.absolute():raise ValueError('LATENTSYNC_UNSAFE_STORAGE')
        claim=folder/(scope['requestId']+'.claim');receipt=folder/(scope['requestId']+'.json');video=folder/(scope['requestId']+'.mp4')
        if claim.exists():
            if json.loads(claim.read_text(encoding='utf-8')).get('requestFingerprint')!=fingerprint:raise RuntimeError('LATENTSYNC_REQUEST_IDEMPOTENCY_CONFLICT')
            if not receipt.is_file():raise RuntimeError('LATENTSYNC_REQUEST_STATE_UNKNOWN')
            value=json.loads(receipt.read_text(encoding='utf-8'))
            if value.get('status')!='completed':raise RuntimeError('LATENTSYNC_REQUEST_FAILED_NO_RETRY')
            if value.get('operation')=='lip_sync':
                data=video.read_bytes()
                if hashlib.sha256(data).hexdigest()!=value['metadata']['sha256']:raise RuntimeError('LATENTSYNC_OUTPUT_CHANGED')
                return {**value,'videoBytes':data}
            return value
        with claim.open('x',encoding='utf-8') as stream:json.dump({'scope':scope,'requestFingerprint':fingerprint},stream)
        self.results.commit();progress=[]
        def checkpoint(status,**extra):
            value={'scope':scope,'engineId':self.config['engineId'],'accountId':self.config['accountId'],'runId':self.runtime_id,'requestId':scope['requestId'],'operation':checked['operation'],'status':status,'modelRevision':self.manifest['revision'],'requestFingerprint':fingerprint,'progress':progress[-1] if progress else None,**extra};tmp=receipt.with_suffix('.pending');tmp.write_text(json.dumps(value,sort_keys=True),encoding='utf-8');tmp.replace(receipt);p=folder.parent/'progress';p.mkdir(exist_ok=True);tmp=p/(scope['requestId']+'.pending');tmp.write_text(json.dumps(value),encoding='utf-8');tmp.replace(p/(scope['requestId']+'.json'));self.results.commit();return value
        checkpoint('running')
        def on_progress(value):progress.append(value);checkpoint('running')
        try:
            generated=self.runtime.generate(request,folder/('work-'+scope['requestId']),on_progress)
            if checked['operation']=='lip_sync':
                Path(generated.pop('videoPath')).replace(video);metadata={**generated.pop('metadata'),'sha256':generated['sha256'],'inferenceSeconds':generated['inferenceSeconds']};value=checkpoint('completed',metadata=metadata);return {**value,'videoBytes':video.read_bytes()}
            return checkpoint('completed',metadata=generated)
        except BaseException as error:
            code=str(error) if re.fullmatch(r'LATENTSYNC_[A-Z_]+',str(error)) else 'LATENTSYNC_GENERATION_FAILED';checkpoint('failed',error=code,needsReview='REVIEW_REQUIRED' in code);raise RuntimeError(code) from None


def build_latentsync_app(config,sdk=None):
    # The wrapper package needs a distinct remote import name: upstream already
    # owns `latentsync`. Register source references to the exact remote alias.
    if __package__!='latentsync_runtime':
        if 'latentsync_runtime' not in sys.modules:
            spec=importlib.util.spec_from_file_location('latentsync_runtime',ROOT/'__init__.py',submodule_search_locations=[str(ROOT)]);package=importlib.util.module_from_spec(spec);sys.modules['latentsync_runtime']=package;spec.loader.exec_module(package)
        return importlib.import_module('latentsync_runtime.modal_app').build_latentsync_app(config,sdk)
    config=deployment_config(config)
    if sdk is None:sdk=modal
    app=sdk.App(config['appName']);weights=sdk.Volume.from_name(config['modelVolume'],create_if_missing=False);results=sdk.Volume.from_name(config['resultsVolume'],create_if_missing=False);environment={ENV:json.dumps({k:v for k,v in config.items() if k!='appName'},sort_keys=True)}
    app.function(name='prepare_models',image=build_preparation_image(sdk),env=environment,include_source=False,cpu=(2,2),memory=(8192,8192),timeout=3600,startup_timeout=180,retries=0,max_containers=1,min_containers=0,buffer_containers=0,scaledown_window=2,volumes={'/models':weights,'/results':results})(prepare_models)
    remote=app.cls(image=build_model_image(sdk),env=environment,include_source=False,gpu='L40S',cpu=(4,4),memory=(32768,32768),timeout=config['timeout'],startup_timeout=config['startupTimeout'],retries=0,max_containers=1,min_containers=0,buffer_containers=0,scaledown_window=config['idleSeconds'],volumes={'/models':weights.with_mount_options(read_only=True),'/results':results})(LatentSyncEngine)
    return app,remote
