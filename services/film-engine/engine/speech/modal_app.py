"""Reusable named-app definitions only; no run/deploy/spawn or resource creation.

The explicit provisioning bridge must create both scoped Volumes and deploy this
factory after separate approval. Metadata/status observations read receipts and
Modal control-plane state; calling a GPU method is never a free status probe.
"""
import hashlib
import json
import os
import modal
from pathlib import Path
import re
from .image import build_model_image,build_preparation_image
from .storage import canonical_mount,scoped_directory
from .runtime import SpeechRuntime,manifest_for,manifest_fingerprint,validate_scope,validate_request

UUID=re.compile(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')
NAME=re.compile(r'^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$')


def deployment_config(config):
    if not isinstance(config,dict):raise ValueError('SPEECH_INVALID_DEPLOYMENT')
    required={'modelId','engineId','accountId','modelVolume','resultsVolume','weightPath','gpu','cpu','ramGiB'}
    if not required.issubset(config) or set(config)-required-{'timeout','startupTimeout','idleSeconds'}:raise ValueError('SPEECH_INVALID_DEPLOYMENT')
    if not UUID.fullmatch(config.get('engineId','')) or not NAME.fullmatch(config.get('accountId','')):raise ValueError('SPEECH_INVALID_DEPLOYMENT')
    manifest_for(config['modelId'])
    expected_results='mashhad-speech-'+config['modelId']+'-results-'+hashlib.sha256(config['engineId'].encode()).hexdigest()[:16]
    if not NAME.fullmatch(config.get('modelVolume','')) or config.get('resultsVolume')!=expected_results or config['resultsVolume']==config['modelVolume']:
        raise ValueError('SPEECH_RESULT_STORAGE_REQUIRED')
    parts=config.get('weightPath','').split('/')
    if len(parts)<2 or any(not NAME.fullmatch(p) for p in parts) or config['weightPath']!='models/'+config['modelId']+'/'+config['engineId']:raise ValueError('SPEECH_INVALID_DEPLOYMENT')
    if config['gpu']!='L40S' or type(config['cpu']) is not int or config['cpu'] not in (2,4) or type(config['ramGiB']) is not int or config['ramGiB'] not in (16,32):
        raise ValueError('SPEECH_INVALID_DEPLOYMENT')
    result={**config,'appName':'mashhad-speech-'+config['modelId']+'-'+config['engineId'].replace('-','')[:12],
            'timeout':config.get('timeout',600),'startupTimeout':config.get('startupTimeout',180),'idleSeconds':config.get('idleSeconds',1200)}
    for name,minimum,maximum in [('timeout',60,3600),('startupTimeout',60,1800),('idleSeconds',2,1200)]:
        if type(result[name]) is not int or not minimum<=result[name]<=maximum:raise ValueError('SPEECH_INVALID_DEPLOYMENT')
    return result


DEPLOYMENT_ENV='MASHHAD_SPEECH_DEPLOYMENT'


def prepare_models(request):
    config=deployment_config(json.loads(os.environ[DEPLOYMENT_ENV]))
    engine_id,account_id=config['engineId'],config['accountId']
    model_dir=scoped_directory(canonical_mount('/models'),config['weightPath'])
    results_dir=canonical_mount('/results')
    scoped_directory(results_dir,'preparations')
    weights=modal.Volume.from_name(config['modelVolume'],create_if_missing=False)
    results=modal.Volume.from_name(config['resultsVolume'],create_if_missing=False)
    from speech.prepare import prepare_models as prepare
    if any(request.get(key)!=config[key] for key in ('modelVolume','resultsVolume','weightPath')):
        raise ValueError('SPEECH_SCOPE_MISMATCH')
    def commit():weights.commit();results.commit()
    if request.get('modelId')!=config['modelId']:raise ValueError('SPEECH_SCOPE_MISMATCH')
    return prepare(request,model_dir=model_dir,results_dir=results_dir,engine_id=engine_id,account_id=account_id,commit=commit)


class SpeechEngine:
    runtime_id:str=modal.parameter()

    @modal.enter()
    def initialize(self):
        self.config=deployment_config(json.loads(os.environ[DEPLOYMENT_ENV]))
        self.manifest=manifest_for(self.config['modelId'])
        self.runtime=SpeechRuntime(scoped_directory(canonical_mount('/models'),self.config['weightPath']),self.config['modelId'],expected_scope={'engineId':self.config['engineId'],'accountId':self.config['accountId']})
        self.results_root=canonical_mount('/results')
        self.results=modal.Volume.from_name(self.config['resultsVolume'],create_if_missing=False)

    @modal.method()
    def start(self,scope):
        validate_scope(scope,self.config['engineId'],self.config['accountId'],self.runtime_id)
        ready=self.runtime.prepare()
        folder=scoped_directory(self.results_root,'runs/'+self.runtime_id);folder.mkdir(parents=True,exist_ok=True,mode=0o700)
        marker=folder/'start.json';marker.write_text(json.dumps({'scope':scope,'ready':True,'modelRevision':self.manifest['revision'],'manifestFingerprint':manifest_fingerprint(self.config['modelId'])}),encoding='utf-8');self.results.commit()
        return {'engineId':self.config['engineId'],'accountId':self.config['accountId'],'runId':self.runtime_id,
                'ready':ready['ready'],'modelId':self.config['modelId'],'modelRevision':self.manifest['revision'],
                'loadSeconds':ready['loadSeconds'],'manifestFingerprint':manifest_fingerprint(self.config['modelId'])}

    @modal.method()
    def generate(self,request,scope):
        validate_scope(scope,self.config['engineId'],self.config['accountId'],self.runtime_id,request_required=True)
        checked=validate_request(request,self.config['modelId'])
        fingerprint=hashlib.sha256(json.dumps({**checked,'reference_audio':hashlib.sha256(checked['reference_audio']).hexdigest()},sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
        folder=scoped_directory(self.results_root,'runs/'+self.runtime_id+'/results');folder.mkdir(parents=True,exist_ok=True,mode=0o700)
        if folder.is_symlink() or folder.resolve()!=folder.absolute():raise ValueError('SPEECH_UNSAFE_OUTPUT')
        receipt=folder/(scope['requestId']+'.json');image_path=folder/(scope['requestId']+'.wav');claim=folder/(scope['requestId']+'.claim')
        if claim.exists():
            saved=json.loads(claim.read_text(encoding='utf-8'))
            if saved.get('requestFingerprint')!=fingerprint:raise RuntimeError('SPEECH_REQUEST_IDEMPOTENCY_CONFLICT')
            if not receipt.is_file():raise RuntimeError('SPEECH_REQUEST_STATE_UNKNOWN')
            value=json.loads(receipt.read_text(encoding='utf-8'))
            if value.get('status')!='completed':raise RuntimeError('SPEECH_REQUEST_FAILED_NO_RETRY')
            data=image_path.read_bytes()
            if hashlib.sha256(data).hexdigest()!=value['metadata']['sha256']:raise RuntimeError('SPEECH_OUTPUT_CHANGED')
            return {**value,'wavBytes':data}
        with claim.open('x',encoding='utf-8') as stream:json.dump({'scope':scope,'requestFingerprint':fingerprint},stream)
        self.results.commit();progress=[]
        def checkpoint(status,**extra):
            value={'scope':scope,'engineId':self.config['engineId'],'accountId':self.config['accountId'],'runId':self.runtime_id,
                   'requestId':scope['requestId'],'status':status,'requestFingerprint':fingerprint,
                   'modelRevision':self.manifest['revision'],'progress':progress[-1] if progress else None,**extra}
            temporary=receipt.with_suffix('.pending');temporary.write_text(json.dumps(value,sort_keys=True),encoding='utf-8');temporary.replace(receipt)
            progress_folder=scoped_directory(self.results_root,'runs/'+self.runtime_id+'/progress');progress_folder.mkdir(exist_ok=True,mode=0o700);progress_file=progress_folder/(scope['requestId']+'.json');progress_temp=progress_file.with_suffix('.pending');progress_temp.write_text(json.dumps(value,sort_keys=True),encoding='utf-8');progress_temp.replace(progress_file)
            self.results.commit();return value
        checkpoint('running')
        try:
            def on_progress(value):progress.append(value);checkpoint('running')
            generated=self.runtime.generate(request,folder/('work-'+scope['requestId']),on_progress)
            source=Path(generated.pop('audioPath'));generated.pop('metadataPath')
            source.replace(image_path)
            value=checkpoint('completed',metadata=generated)
            return {**value,'wavBytes':image_path.read_bytes()}
        except BaseException:
            checkpoint('failed',error='SPEECH_GENERATION_FAILED')
            raise RuntimeError('SPEECH_GENERATION_FAILED') from None


def build_speech_app(config,sdk=None):
    config=deployment_config(config)
    if sdk is None:sdk=modal
    app=sdk.App(config['appName'])
    weights=sdk.Volume.from_name(config['modelVolume'],create_if_missing=False)
    results=sdk.Volume.from_name(config['resultsVolume'],create_if_missing=False)
    # Definition/account scope is function configuration, never an Image layer.
    environment={DEPLOYMENT_ENV:json.dumps({k:v for k,v in config.items() if k!='appName'},sort_keys=True)}
    app.function(name='prepare_models',image=build_preparation_image(sdk),env=environment,include_source=False,
                 cpu=(2,2),memory=(8192,8192),timeout=3600,startup_timeout=180,retries=0,
                 max_containers=1,min_containers=0,buffer_containers=0,scaledown_window=2,
                 secrets=[sdk.Secret.from_name('mashhad-hf-read')] if config['modelId']=='audar-tts-v1-flash' else [],
                 volumes={'/models':weights,'/results':results})(prepare_models)
    remote=app.cls(image=build_model_image(sdk),env=environment,include_source=False,gpu=config['gpu'],
                   cpu=(config['cpu'],config['cpu']),memory=(config['ramGiB']*1024,config['ramGiB']*1024),
                   timeout=config['timeout'],startup_timeout=config['startupTimeout'],retries=0,
                   max_containers=1,min_containers=0,buffer_containers=0,scaledown_window=config['idleSeconds'],
                   volumes={'/models':weights.with_mount_options(read_only=True),'/results':results})(SpeechEngine)
    return app,remote
