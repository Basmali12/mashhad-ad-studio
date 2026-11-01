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
from .runtime import HunyuanVideoRuntime,MANIFEST,MODEL_ID,MODEL_REVISION,manifest_fingerprint,validate_scope,validate_request

UUID=re.compile(r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$')
NAME=re.compile(r'^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$')


def deployment_config(config):
    if not isinstance(config,dict):raise ValueError('HUNYUAN_INVALID_DEPLOYMENT')
    required={'engineId','accountId','modelVolume','resultsVolume','weightPath','gpu','cpu','ramGiB'}
    if not required.issubset(config) or set(config)-required-{'timeout','startupTimeout','idleSeconds'}:raise ValueError('HUNYUAN_INVALID_DEPLOYMENT')
    if not UUID.fullmatch(config.get('engineId','')) or not NAME.fullmatch(config.get('accountId','')):raise ValueError('HUNYUAN_INVALID_DEPLOYMENT')
    expected_results='mashhad-hunyuan-results-'+hashlib.sha256(config['engineId'].encode()).hexdigest()[:16]
    if not NAME.fullmatch(config.get('modelVolume','')) or config.get('resultsVolume')!=expected_results or config['resultsVolume']==config['modelVolume']:
        raise ValueError('HUNYUAN_RESULT_STORAGE_REQUIRED')
    parts=config.get('weightPath','').split('/')
    if len(parts)<2 or any(not NAME.fullmatch(p) for p in parts) or config['weightPath']!='models/'+MODEL_ID+'/'+config['engineId']:raise ValueError('HUNYUAN_INVALID_DEPLOYMENT')
    if config['gpu']!='RTX-PRO-6000' or type(config['cpu']) is not int or config['cpu'] not in (4,8) or type(config['ramGiB']) is not int or config['ramGiB'] not in (128,256):
        raise ValueError('HUNYUAN_INVALID_DEPLOYMENT')
    result={**config,'appName':'mashhad-hunyuan-'+config['engineId'].replace('-','')[:12],
            'timeout':config.get('timeout',1800),'startupTimeout':config.get('startupTimeout',900),'idleSeconds':config.get('idleSeconds',1200)}
    for name,minimum,maximum in [('timeout',60,3600),('startupTimeout',60,1800),('idleSeconds',2,1200)]:
        if type(result[name]) is not int or not minimum<=result[name]<=maximum:raise ValueError('HUNYUAN_INVALID_DEPLOYMENT')
    return result


DEPLOYMENT_ENV='MASHHAD_HUNYUAN_DEPLOYMENT'


def prepare_models(request):
    config=deployment_config(json.loads(os.environ[DEPLOYMENT_ENV]))
    engine_id,account_id=config['engineId'],config['accountId']
    model_dir=scoped_directory(canonical_mount('/models'),config['weightPath'])
    results_dir=canonical_mount('/results')
    scoped_directory(results_dir,'preparations')
    weights=modal.Volume.from_name(config['modelVolume'],create_if_missing=False)
    results=modal.Volume.from_name(config['resultsVolume'],create_if_missing=False)
    from hunyuan.prepare import prepare_models as prepare
    if any(request.get(key)!=config[key] for key in ('modelVolume','resultsVolume','weightPath')):
        raise ValueError('HUNYUAN_SCOPE_MISMATCH')
    def commit():weights.commit();results.commit()
    return prepare(request,model_dir=model_dir,results_dir=results_dir,engine_id=engine_id,account_id=account_id,commit=commit)


class HunyuanEngine:
    runtime_id:str=modal.parameter()

    @modal.enter()
    def initialize(self):
        self.config=deployment_config(json.loads(os.environ[DEPLOYMENT_ENV]))
        self.runtime=HunyuanVideoRuntime(scoped_directory(canonical_mount('/models'),self.config['weightPath']),expected_scope={'engineId':self.config['engineId'],'accountId':self.config['accountId']})
        self.results_root=canonical_mount('/results')
        self.results=modal.Volume.from_name(self.config['resultsVolume'],create_if_missing=False)

    @modal.method()
    def start(self,scope):
        validate_scope(scope,self.config['engineId'],self.config['accountId'],self.runtime_id)
        ready=self.runtime.prepare()
        folder=scoped_directory(self.results_root,'runs/'+self.runtime_id);folder.mkdir(parents=True,exist_ok=True,mode=0o700)
        marker=folder/'start.json';marker.write_text(json.dumps({'scope':scope,'ready':True,'modelRevision':MODEL_REVISION,'manifestFingerprint':manifest_fingerprint()}),encoding='utf-8');self.results.commit()
        return {'engineId':self.config['engineId'],'accountId':self.config['accountId'],'runId':self.runtime_id,
                'ready':ready['ready'],'modelId':MODEL_ID,'modelRevision':MODEL_REVISION,'loadedVariant':ready['variant'],
                'loadSeconds':ready['loadSeconds'],'manifestFingerprint':manifest_fingerprint()}

    @modal.method()
    def generate(self,request,scope):
        validate_scope(scope,self.config['engineId'],self.config['accountId'],self.runtime_id,request_required=True)
        checked=validate_request(request)
        fingerprint=hashlib.sha256(json.dumps({**checked,'reference_images':[hashlib.sha256(value).hexdigest() for value in checked['reference_images']]},sort_keys=True,separators=(',',':')).encode()).hexdigest()
        folder=scoped_directory(self.results_root,'runs/'+self.runtime_id+'/results');folder.mkdir(parents=True,exist_ok=True,mode=0o700)
        if folder.is_symlink() or folder.resolve()!=folder.absolute():raise ValueError('HUNYUAN_UNSAFE_OUTPUT')
        receipt=folder/(scope['requestId']+'.json');image_path=folder/(scope['requestId']+'.mp4');claim=folder/(scope['requestId']+'.claim')
        if claim.exists():
            saved=json.loads(claim.read_text(encoding='utf-8'))
            if saved.get('requestFingerprint')!=fingerprint:raise RuntimeError('HUNYUAN_REQUEST_IDEMPOTENCY_CONFLICT')
            if not receipt.is_file():raise RuntimeError('HUNYUAN_REQUEST_STATE_UNKNOWN')
            value=json.loads(receipt.read_text(encoding='utf-8'))
            if value.get('status')!='completed':raise RuntimeError('HUNYUAN_REQUEST_FAILED_NO_RETRY')
            data=image_path.read_bytes()
            if hashlib.sha256(data).hexdigest()!=value['metadata']['sha256']:raise RuntimeError('HUNYUAN_OUTPUT_CHANGED')
            return {**value,'mp4Bytes':data}
        with claim.open('x',encoding='utf-8') as stream:json.dump({'scope':scope,'requestFingerprint':fingerprint},stream)
        self.results.commit();progress=[]
        def checkpoint(status,**extra):
            value={'scope':scope,'engineId':self.config['engineId'],'accountId':self.config['accountId'],'runId':self.runtime_id,
                   'requestId':scope['requestId'],'status':status,'requestFingerprint':fingerprint,
                   'modelRevision':MODEL_REVISION,'progress':progress[-1] if progress else None,**extra}
            temporary=receipt.with_suffix('.pending');temporary.write_text(json.dumps(value,sort_keys=True),encoding='utf-8');temporary.replace(receipt)
            progress_folder=scoped_directory(self.results_root,'runs/'+self.runtime_id+'/progress');progress_folder.mkdir(exist_ok=True,mode=0o700);progress_file=progress_folder/(scope['requestId']+'.json');progress_temp=progress_file.with_suffix('.pending');progress_temp.write_text(json.dumps(value,sort_keys=True),encoding='utf-8');progress_temp.replace(progress_file)
            self.results.commit();return value
        checkpoint('running')
        try:
            def on_progress(value):progress.append(value);checkpoint('running')
            generated=self.runtime.generate(request,folder/('work-'+scope['requestId']),on_progress)
            source=Path(generated.pop('videoPath'));generated.pop('metadataPath')
            source.replace(image_path)
            value=checkpoint('completed',metadata=generated)
            return {**value,'mp4Bytes':image_path.read_bytes()}
        except BaseException:
            checkpoint('failed',error='HUNYUAN_GENERATION_FAILED')
            raise RuntimeError('HUNYUAN_GENERATION_FAILED') from None


def build_hunyuan_app(config,sdk=None):
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
                 volumes={'/models':weights,'/results':results})(prepare_models)
    remote=app.cls(image=build_model_image(sdk),env=environment,include_source=False,gpu=config['gpu'],
                   cpu=(config['cpu'],config['cpu']),memory=(config['ramGiB']*1024,config['ramGiB']*1024),
                   timeout=config['timeout'],startup_timeout=config['startupTimeout'],retries=0,
                   max_containers=1,min_containers=0,buffer_containers=0,scaledown_window=config['idleSeconds'],
                   volumes={'/models':weights.with_mount_options(read_only=True),'/results':results})(HunyuanEngine)
    return app,remote
