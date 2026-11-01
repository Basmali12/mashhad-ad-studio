"""Pinned Modal SDK transport. Secret JSON arrives on stdin; raw errors never leave.
Import is inert. Only explicit paid actions prepare/deploy or invoke named model functions.
"""
import base64
import asyncio
import hashlib
import importlib
import io
import wave
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parent
ID=re.compile(r'^[A-Za-z0-9_-]{1,100}$')
CALL=re.compile(r'^fc-[A-Za-z0-9_-]+$')
MAX_JSON=131072
MAX_IMAGE=16*1024*1024
MAX_VIDEO=64*1024*1024
MAX_AUDIO=32*1024*1024
MODELS={
    'latentsync16':{'package':'latentsync','manifestPath':'latentsync/manifest.json','version':'1.6','className':'LatentSyncEngine','deployFunction':'deploy_latentsync_app','steps':3,'unit':'steps','timeout':600,'waitSeconds':900},
    'hunyuanvideo15':{'package':'hunyuan','version':'1.5','className':'HunyuanEngine','deployFunction':'deploy_hunyuan_app','steps':50,'timeout':1800,'waitSeconds':2000},
    'wan22-i2v-a14b':{'package':'wan','version':'2.2','className':'WanEngine','deployFunction':'deploy_wan_app','steps':40,'timeout':1800,'waitSeconds':2000},
    'flux2-klein-4b':{'package':'flux','version':'4B','className':'KleinEngine','deployFunction':'deploy_flux_app','steps':4,'timeout':600},
    'qwen-image-edit-2511':{'package':'qwen','version':'2511','className':'QwenEngine','deployFunction':'deploy_qwen_app','steps':40,'timeout':600},
}
for model in ('habibi-irq','habibi-egy','habibi-msa','audar-tts-v1-flash'):
    MODELS[model]={'package':'speech','namespace':'speech-'+model,'manifestPath':'speech/manifests/'+model+'.json','version':'V1-Flash' if model=='audar-tts-v1-flash' else '0.1.1-specialized','className':'SpeechEngine','deployFunction':'deploy_speech_app','steps':1,'unit':'chunks','timeout':600}
ACTIVE_MODEL=None


def model_config(request):
    model=(request.get('definition') or {}).get('modelId')
    if model not in MODELS:raise ValueError('FLUX_MODEL_UNSUPPORTED')
    return MODELS[model]


def emit(kind,data):
    print(json.dumps({'type':kind,'data':data},ensure_ascii=False),flush=True)


def fingerprint(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()


def validate(request):
    if request.get('action') not in ('inspect','prepare','observe_preparation','cancel_preparation','start','observe','stop','cancel_call','generate','observe_result'):
        raise ValueError('FLUX_ACTION_INVALID')
    config=model_config(request)
    manifest=json.loads((ROOT/config.get('manifestPath',config['package']+'/model-manifest.json')).read_text(encoding='utf-8'))
    if request.get('manifestFingerprint')!=fingerprint(manifest) or request.get('manifest')!=manifest:
        raise ValueError('FLUX_PROFILE_CHANGED')
    d=request.get('definition') or {}
    if d.get('modelId')!=manifest.get('modelId') or d.get('version')!=config['version'] or manifest.get('version')!=config['version'] or any(not isinstance(d.get(k),str) or not ID.fullmatch(d[k]) for k in ('id','accountId','volume')):
        raise ValueError('FLUX_SCOPE_INVALID')
    if d.get('weightPath')!='models/'+d['modelId']+'/'+d['id']:
        raise ValueError('FLUX_SCOPE_INVALID')
    app='mashhad-'+config.get('namespace',config['package'])+'-'+d['id'].replace('-','')[:12]
    results='mashhad-'+config.get('namespace',config['package'])+'-results-'+hashlib.sha256(d['id'].encode()).hexdigest()[:16]
    if request.get('appName')!=app or request.get('resultsVolume')!=results:
        raise ValueError('FLUX_SCOPE_INVALID')
    if d['modelId']=='audar-tts-v1-flash' and request['action'] in ('prepare','start','generate') and (request.get('licenseAccepted') is not True or request.get('codecLicenseAccepted') is not True):raise ValueError('SPEECH_LICENSE_ACKNOWLEDGEMENT_REQUIRED')
    if config['package']=='latentsync' and request['action'] in ('prepare','start','generate') and (request.get('usageMode')!='noncommercial_research' or request.get('researchOnly') is not True or request.get('licenseAccepted') is not True or request.get('faceModelRightsApproved') is not True or not isinstance(request.get('rightsEvidence'),str) or not 8<=len(request['rightsEvidence'].strip())<=1000):raise ValueError('LATENTSYNC_COMMERCIAL_RIGHTS_REQUIRED')
    if config['package']=='hunyuan' and request['action'] in ('prepare','start','generate') and request.get('licenseAccepted') is not True:raise ValueError('HUNYUAN_LICENSE_ACKNOWLEDGEMENT_REQUIRED')
    if request['action'] in ('prepare','start','generate') and request.get('paidApproved') is not True:
        raise ValueError('FLUX_APPROVAL_REQUIRED')
    for key in ('runId','requestId','operationId'):
        if key in request and (not isinstance(request[key],str) or not ID.fullmatch(request[key])):
            raise ValueError('FLUX_SCOPE_INVALID')
    return d,manifest


def client(request):
    import modal
    if modal.__version__!='1.6.2':raise RuntimeError('FLUX_SDK_VERSION')
    credentials=request.get('credentials') or {}
    if not re.fullmatch(r'ak-[A-Za-z0-9_-]{8,200}',credentials.get('tokenId','')) or not re.fullmatch(r'as-[A-Za-z0-9_-]{8,200}',credentials.get('tokenSecret','')):
        raise ValueError('FLUX_ACCOUNT_UNAVAILABLE')
    c=modal.Client.from_credentials(credentials['tokenId'],credentials['tokenSecret'])
    workspace=modal.Workspace.from_context(client=c);workspace.hydrate()
    if workspace.name!=credentials.get('expectedWorkspace'):raise RuntimeError('FLUX_ACCOUNT_MISMATCH')
    return c


def scope(request,run_key='runId'):
    d=request['definition']
    return {'engineId':d['id'],'accountId':d['accountId'],'runId':request[run_key],'requestId':request['requestId']}


def read_small(volume,path,maximum=MAX_JSON):
    chunks=[];size=0
    for chunk in volume.read_file(path):
        size+=len(chunk)
        if size>maximum:raise ValueError('FLUX_RESPONSE_LIMIT')
        chunks.append(chunk)
    return b''.join(chunks)


def inspect(request,c):
    import modal
    d=request['definition'];manifest=request['manifest'];prefix=d['weightPath'];codec_secret=None
    if d['modelId']=='audar-tts-v1-flash':
        try:modal.Secret.from_name('mashhad-hf-read',client=c,environment_name='main').hydrate();codec_secret=True
        except Exception:codec_secret=False
    files=[];marker=None;vol=modal.Volume.from_name(d['volume'],client=c,environment_name='main',create_if_missing=False)
    try:entries={e.path.lstrip('/'):e for e in vol.listdir(prefix,recursive=True)}
    except Exception:entries={}
    entry=entries.get(prefix+'/READY.json')
    if entry and entry.size<=MAX_JSON:
        try:marker=json.loads(read_small(vol,prefix+'/READY.json'))
        except Exception:marker=None
    valid=bool(isinstance(marker,dict) and marker.get('hashVerified') is True and marker.get('engineId')==d['id'] and marker.get('accountId')==d['accountId'] and marker.get('revision')==manifest['revision'] and marker.get('modelId')==manifest['modelId'] and marker.get('manifestFingerprint')==request['manifestFingerprint'])
    for spec in manifest['files']:
        found=entries.get(prefix+'/'+spec['path']);present=bool(found and found.size==spec['size'])
        verified=valid and present and any(row.get('path')==spec['path'] and row.get('size')==spec['size'] and row.get('sha256')==spec['sha256'] for row in marker.get('files',[]) if isinstance(row,dict))
        files.append({'path':spec['path'],'size':found.size if found else None,'sha256':spec['sha256'] if verified else None,'present':present,'verified':verified})
    worker=False
    try:modal.Function.from_name(request['appName'],'prepare_models',client=c,environment_name='main').hydrate();worker=True
    except Exception:pass
    deployment=metadata(request);attestation=None
    try:
        result_volume=modal.Volume.from_name(request['resultsVolume'],client=c,create_if_missing=False,environment_name='main')
        saved=json.loads(read_small(result_volume,'deployment.json'))
        if isinstance(saved,dict) and all(saved.get(k)==v for k,v in {'engineId':d['id'],'accountId':d['accountId'],'appId':deployment['appId'],'appName':request['appName'],'modelVolume':d['volume'],'resultsVolume':request['resultsVolume'],'weightPath':d['weightPath'],'manifestFingerprint':request['manifestFingerprint'],'modelRevision':manifest['revision']}.items()):
            remote=modal.Cls.from_name(request['appName'],model_config(request)['className'],client=c,environment_name='main');remote.hydrate()
            if saved.get('classId')==remote.object_id:attestation=saved
    except Exception:pass
    return {**({'codecAuthorized':None,'codecAccess':{'secretConfigured':codec_secret,'status':'local_files_verified' if all(f['verified'] for f in files) else 'unverified','authorized':None}} if codec_secret is not None else {}),'deploymentReady':not deployment['deploymentRequired'] and attestation is not None,'appId':deployment['appId'],'deploymentFingerprint':attestation.get('manifestFingerprint') if attestation else None,'accountId':d['accountId'],'volume':d['volume'],'weightPath':prefix,'revision':manifest['revision'],'files':files,'ready':all(f['verified'] for f in files),'prepareWorkerReady':worker,'verification':'scoped_READY_attestation_and_sizes_not_fresh_full_file_hash','gpuUsed':False}


async def _metadata(request):
    from modal.client import _Client
    from modal_proto import api_pb2 as api
    credentials=request['credentials'];c=await _Client.from_credentials(credentials['tokenId'],credentials['tokenSecret'])
    rows=await c._stub.AppList(api.AppListRequest(environment_name='main'))
    candidates=[a for a in rows.apps if a.name==request['appName'] or a.description==request['appName']]
    requested=request.get('appId')
    if requested:
        info=(await c._stub.AppGetInfo(api.AppGetInfoRequest(app_id=requested))).info
        if info.description!=request['appName'] or info.environment_name!='main':raise ValueError('FLUX_APP_SCOPE_INVALID')
        app_id=requested;stopped=info.lifecycle.app_state==api.APP_STATE_STOPPED
    else:
        candidates=[a for a in candidates if a.state!=api.APP_STATE_STOPPED]
        if not candidates:return {'appId':None,'activeTasks':0,'containerIds':[],'deploymentRequired':True}
        if len(candidates)!=1:raise ValueError('FLUX_APP_SCOPE_INVALID')
        app_id=candidates[0].app_id;stopped=False
    tasks=await c._stub.TaskList(api.TaskListRequest(environment_name='main',app_id=app_id))
    ids=[]
    for task in tasks.tasks:
        task_id=getattr(task,'task_id',None) or getattr(task,'id',None)
        if not isinstance(task_id,str) or not re.fullmatch(r'ta-[A-Za-z0-9_-]+',task_id):raise ValueError('FLUX_TASK_SCOPE_INVALID')
        if not getattr(task,'finished_at',0):ids.append(task_id)
    return {'appId':app_id,'activeTasks':len(ids),'containerIds':ids,'deploymentRequired':stopped}


def metadata(request):
    from modal._utils.async_utils import synchronize_api
    return synchronize_api(_metadata)(request)


async def _call_statuses(request):
    # Same pinned SDK 1.6.2 read boundary used by FunctionCall.get, without
    # deserializing provider exceptions or downloading multi-MB image results.
    from modal.client import _Client
    from modal_proto import api_pb2 as api
    credentials=request['credentials'];c=await _Client.from_credentials(credentials['tokenId'],credentials['tokenSecret'])
    for call_id in request.get('functionCallIds',[]):
        checked_call_id(call_id)
        result=await asyncio.wait_for(c._stub.FunctionGetOutputs(api.FunctionGetOutputsRequest(function_call_id=call_id,timeout=0,last_entry_id='0-0',clear_on_success=False,requested_at=time.time(),start_idx=0,end_idx=0)),20)
        if result.num_unfinished_inputs!=0:return False
    return True


def call_statuses(request):
    from modal._utils.async_utils import synchronize_api
    try:return synchronize_api(_call_statuses)(request)
    except BaseException:return False


async def _preparation_failed(request):
    """Read terminal failure metadata only; never deserialize remote exceptions."""
    from modal.client import _Client
    from modal_proto import api_pb2 as api
    call_id=checked_call_id(request['functionCallId'])
    credentials=request['credentials'];c=await _Client.from_credentials(credentials['tokenId'],credentials['tokenSecret'])
    result=await asyncio.wait_for(c._stub.FunctionGetOutputs(api.FunctionGetOutputsRequest(function_call_id=call_id,timeout=0,last_entry_id='0-0',clear_on_success=False,requested_at=time.time(),start_idx=0,end_idx=0)),20)
    return result.num_unfinished_inputs==0 and bool(result.outputs) and all(output.result.status==api.GenericResult.GENERIC_STATUS_FAILURE for output in result.outputs)


def preparation_failed(request):
    from modal._utils.async_utils import synchronize_api
    try:return synchronize_api(_preparation_failed)(request)
    except Exception:return False


def cls(request,c):
    import modal
    d=request['definition']
    klass=modal.Cls.from_name(request['appName'],model_config(request)['className'],client=c,environment_name='main')
    lifecycle={'scaledown_window':60,'timeout':model_config(request)['timeout']}
    if d['modelId']=='flux2-klein-4b':
        timeout=d.get('timeout',600);startup=d.get('startupTimeout',180);idle=d.get('idleSeconds',1200)
        for value,minimum,maximum in [(timeout,60,3600),(startup,60,1800),(idle,2,1200)]:
            if type(value) is not int or not minimum<=value<=maximum:raise ValueError('FLUX_INVALID_DEPLOYMENT')
        # Modal1.6.2 with_options cannot override startup_timeout/min_containers.
        # Those stay on the explicitly deployed class (startupTimeout/min0).
        lifecycle={'scaledown_window':idle,'timeout':timeout}
    return klass.with_options(cpu=(d['cpu'],d['cpu']),memory=(d['ramGiB']*1024,d['ramGiB']*1024),gpu=d['gpu'],retries=0,max_containers=1,buffer_containers=0,**lifecycle)(runtime_id=request['runId'])


def checked_call_id(value):
    if not isinstance(value,str) or not CALL.fullmatch(value):raise ValueError('FLUX_CALL_SCOPE_INVALID')
    return value


def observe_call(request,c):
    import modal
    return modal.FunctionCall.from_id(checked_call_id(request['functionCallId']),client=c).get(timeout=0)


def check_scope(value,request,request_required=True):
    if not isinstance(value,dict):raise ValueError('FLUX_RESULT_UNCONFIRMED')
    expected=scope(request)
    if not request_required:expected.pop('requestId',None)
    actual=value.get('scope',value)
    if any(actual.get(k)!=v for k,v in expected.items()):raise ValueError('FLUX_RESULT_UNCONFIRMED')
    return value


def shape_image(value,request):
    check_scope(value,request)
    result=dict(value)
    data=result.pop('pngBytes',result.pop('imageBytes',None))
    if isinstance(data,bytes):result['imageBase64']=base64.b64encode(data).decode()
    encoded=result.get('imageBase64')
    if not isinstance(encoded,str):raise ValueError('FLUX_RESULT_UNCONFIRMED')
    data=base64.b64decode(encoded,validate=True)
    if not 16<=len(data)<=MAX_IMAGE or not data.startswith(b'\x89PNG\r\n\x1a\n'):raise ValueError('FLUX_RESULT_UNCONFIRMED')
    meta=result.get('metadata',result)
    if meta.get('sha256')!=hashlib.sha256(data).hexdigest() or meta.get('revision',meta.get('modelRevision'))!=request['manifest']['revision']:
        raise ValueError('FLUX_RESULT_UNCONFIRMED')
    if model_config(request)['package']=='qwen' and (meta.get('steps')!=40 or meta.get('guidanceScale')!=1 or meta.get('trueCfgScale')!=4):raise ValueError('QWEN_RESULT_SETTINGS_MISMATCH')
    # Paths and provider exceptions are never returned to Node or the browser.
    return {'imageBase64':encoded,'mime':'image/png','width':meta['width'],'height':meta['height'],'sha256':meta['sha256'],'bytes':len(data),'requestId':request['requestId'],'scope':scope(request),'modelRevision':request['manifest']['revision'],'seed':meta.get('seed'),'steps':meta.get('steps'),'guidanceScale':meta.get('guidanceScale'),'trueCfgScale':meta.get('trueCfgScale'),'inferenceSeconds':meta.get('inferenceSeconds'),'loadSeconds':meta.get('loadSeconds'),'peakAllocatedBytes':meta.get('peakAllocatedBytes'),'peakReservedBytes':meta.get('peakReservedBytes')}


def shape_audio(value,request):
    check_scope(value,request);result=dict(value);data=result.pop('wavBytes',result.pop('audioBytes',None))
    if isinstance(data,bytes):result['audioBase64']=base64.b64encode(data).decode()
    encoded=result.get('audioBase64')
    if not isinstance(encoded,str):raise ValueError('SPEECH_RESULT_UNCONFIRMED')
    data=base64.b64decode(encoded,validate=True)
    if not 44<=len(data)<=MAX_AUDIO or data[:4]!=b'RIFF' or data[8:12]!=b'WAVE':raise ValueError('SPEECH_RESULT_UNCONFIRMED')
    with wave.open(io.BytesIO(data),'rb') as wav:
        rate,channels,width,samples=wav.getframerate(),wav.getnchannels(),wav.getsampwidth(),wav.getnframes()
        if rate!=24000 or channels!=1 or width!=2 or not 0<samples/rate<=120 or len(wav.readframes(samples))!=samples*channels*width:raise ValueError('SPEECH_RESULT_SETTINGS_MISMATCH')
    meta=result.get('metadata',result);manifest=request['manifest'];duration=samples/rate*1000
    if meta.get('sha256')!=hashlib.sha256(data).hexdigest() or meta.get('revision')!=manifest['revision'] or meta.get('modelId')!=manifest['modelId'] or meta.get('version')!=manifest['version'] or meta.get('sampleRate')!=rate or meta.get('channels')!=channels or meta.get('sampleWidth')!=width or meta.get('numSamples')!=samples or meta.get('format')!='pcm_s16le' or meta.get('bytes')!=len(data) or abs((meta.get('durationMs') or 0)-duration)>1:raise ValueError('SPEECH_RESULT_UNCONFIRMED')
    text=request.get('request')
    if text:
        for field in ('voiceProfileId','voiceProfileFingerprint','characterId','narrator','utteranceId','locale','expression','seed'):
            if meta.get(field)!=text.get(field):raise ValueError('SPEECH_RESULT_SCOPE_INVALID')
        if meta.get('textSHA256')!=hashlib.sha256(text['text'].encode()).hexdigest() or meta.get('referenceTranscriptSHA256')!=hashlib.sha256(text['referenceTranscript'].encode()).hexdigest() or meta.get('referenceSHA256')!=hashlib.sha256(base64.b64decode(request['referenceAudioBase64'],validate=True)).hexdigest():raise ValueError('SPEECH_RESULT_SCOPE_INVALID')
        if meta.get('speakingRate',1)!=text.get('speakingRate',1):raise ValueError('SPEECH_RESULT_SCOPE_INVALID')
    fields=('sampleRate','channels','sampleWidth','numSamples','durationMs','sha256','bytes','format','textSHA256','referenceSHA256','referenceTranscriptSHA256','voiceProfileId','voiceProfileFingerprint','characterId','narrator','utteranceId','locale','expression','seed','speakingRate','modelId','version','revision','inferenceSeconds','loadSeconds','peakAllocatedBytes','peakReservedBytes')
    metadata={k:meta[k] for k in fields if k in meta}
    return {'audioBase64':encoded,'mime':'audio/wav','bytes':len(data),'sha256':meta['sha256'],'sampleRate':rate,'channels':channels,'numSamples':samples,'durationMs':duration,'metadata':metadata,'scope':scope(request),'requestId':request['requestId'],'modelRevision':manifest['revision']}


def shape_video(value,request):
    check_scope(value,request)
    result=dict(value);data=result.pop('mp4Bytes',result.pop('videoBytes',None))
    if isinstance(data,bytes):result['videoBase64']=base64.b64encode(data).decode()
    encoded=result.get('videoBase64')
    if not isinstance(encoded,str):raise ValueError('WAN_RESULT_UNCONFIRMED')
    data=base64.b64decode(encoded,validate=True);meta=result.get('metadata',result)
    if not 16<=len(data)<=MAX_VIDEO or data[4:8]!=b'ftyp' or meta.get('sha256')!=hashlib.sha256(data).hexdigest() or meta.get('revision',meta.get('modelRevision'))!=request['manifest']['revision']:
        raise ValueError('WAN_RESULT_UNCONFIRMED')
    hunyuan=model_config(request)['package']=='hunyuan';fps=24 if hunyuan else 16;max_frames=121 if hunyuan else 81;steps=50 if hunyuan else 40;cfg=6 if hunyuan else 3.5
    mode=meta.get('mode',(request.get('request') or {}).get('mode'))
    grids=(((480,832),(848,480),(720,1264),(1280,720)) if mode=='image_to_video' else ((480,848),(848,480),(720,1280),(1280,720))) if hunyuan else ((480,832),(832,480),(720,1280),(1280,720))
    if hunyuan and mode not in ('text_to_video','image_to_video'):raise ValueError('HUNYUAN_RESULT_SETTINGS_MISMATCH')
    if meta.get('audio') is not False or meta.get('steps')!=steps or meta.get('guidanceScale')!=cfg or (not hunyuan and meta.get('guidanceScale2')!=3.5) or meta.get('fps')!=fps or type(meta.get('numFrames')) is not int or not 5<=meta['numFrames']<=max_frames or (meta['numFrames']-1)%4 or (meta.get('width'),meta.get('height')) not in grids or abs((meta.get('durationMs') or 0)-meta['numFrames']/fps*1000)>1:raise ValueError('HUNYUAN_RESULT_SETTINGS_MISMATCH' if hunyuan else 'WAN_RESULT_SETTINGS_MISMATCH')
    return {'videoBase64':encoded,'mime':'video/mp4','bytes':len(data),'sha256':meta['sha256'],'width':meta.get('width'),'height':meta.get('height'),'fps':meta.get('fps'),'numFrames':meta.get('numFrames'),'durationMs':meta.get('durationMs'),'audio':False,'hasAudio':False,'metadata':{'mode':meta.get('mode'),'width':meta.get('width'),'height':meta.get('height'),'numFrames':meta.get('numFrames'),'fps':meta.get('fps'),'durationMs':meta.get('durationMs'),'hasAudio':False},'steps':meta.get('steps'),'guidanceScale':meta.get('guidanceScale'),'guidanceScale2':meta.get('guidanceScale2'),'seed':meta.get('seed'),'scope':scope(request),'requestId':request['requestId'],'modelRevision':request['manifest']['revision'],'inferenceSeconds':meta.get('inferenceSeconds'),'loadSeconds':meta.get('loadSeconds'),'peakAllocatedBytes':meta.get('peakAllocatedBytes'),'peakReservedBytes':meta.get('peakReservedBytes')}



def shape_sync(value,request):
    check_scope(value,request);result=dict(value);meta=result.get('metadata',result);operation=result.get('operation',meta.get('operation'));manifest=request['manifest']
    if operation not in ('align','lip_sync') or meta.get('operation')!=operation or meta.get('revision',meta.get('modelRevision'))!=manifest['revision'] or meta.get('modelId')!='latentsync16' or meta.get('version')!='1.6':raise ValueError('LATENTSYNC_RESULT_UNCONFIRMED')
    expected=request.get('request')
    if expected:
        for field in ('speakerId','characterId','voiceProfileId'):
            if meta.get(field)!=expected.get(field):raise ValueError('LATENTSYNC_RESULT_SCOPE_INVALID')
        if meta.get('audioSHA256')!=(expected.get('audio') or {}).get('sha256'):raise ValueError('LATENTSYNC_RESULT_SCOPE_INVALID')
        if operation=='align' and (meta.get('utteranceId')!=expected.get('utteranceId') or meta.get('textSHA256')!=hashlib.sha256(expected['text'].encode()).hexdigest()):raise ValueError('LATENTSYNC_RESULT_SCOPE_INVALID')
        if operation=='lip_sync' and (meta.get('shotId')!=expected.get('shotId') or meta.get('faceBindingId')!=expected.get('faceBindingId') or meta.get('videoSHA256')!=(expected.get('video') or {}).get('sha256')):raise ValueError('LATENTSYNC_RESULT_SCOPE_INVALID')
    safe={k:meta[k] for k in ('operation','modelId','version','revision','modelRevision','speakerId','characterId','voiceProfileId','utteranceId','shotId','faceBindingId','audioSHA256','videoSHA256','textSHA256','locale','durationMs','width','height','fps','numFrames','hasAudio','sha256','needsReview','qualityVerified','transcriptVerified','inferenceSeconds') if k in meta}
    common={'operation':operation,'scope':scope(request),'requestId':request['requestId'],'modelRevision':manifest['revision'],'metadata':safe,'inferenceSeconds':result.get('inferenceSeconds',meta.get('inferenceSeconds'))}
    if operation=='align':
        alignment=result.get('alignment',meta.get('alignment'))
        if not isinstance(alignment,dict) or not isinstance(alignment.get('needsReview'),bool) or not isinstance(alignment.get('durationMs'),(int,float)) or alignment.get('words') is None and alignment['needsReview'] is not True:raise ValueError('LATENTSYNC_ALIGNMENT_INVALID')
        allowed=('words','sentences','segments','confidence','durationMs','needsReview','status','locale','transcriptVerified','audioSHA256','speakerId','characterId','voiceProfileId','utteranceId','textSHA256');common['alignment']={k:alignment[k] for k in allowed if k in alignment};return common
    data=result.pop('videoBytes',result.pop('mp4Bytes',None));encoded=result.get('videoBase64')
    if isinstance(data,bytes):encoded=base64.b64encode(data).decode()
    if not isinstance(encoded,str):raise ValueError('LATENTSYNC_RESULT_UNCONFIRMED')
    data=base64.b64decode(encoded,validate=True)
    if not 24<=len(data)<=MAX_VIDEO or data[4:8]!=b'ftyp' or meta.get('fps')!=25 or meta.get('needsReview') is not True or meta.get('hasAudio') is not True or result.get('sha256',meta.get('sha256'))!=hashlib.sha256(data).hexdigest():raise ValueError('LATENTSYNC_RESULT_UNCONFIRMED')
    safe['sha256']=hashlib.sha256(data).hexdigest();return {**common,'videoBase64':encoded,'sha256':safe['sha256'],'mime':'video/mp4','bytes':len(data)}


def shape_output(value,request):
    return shape_sync(value,request) if model_config(request)['package']=='latentsync' else shape_audio(value,request) if model_config(request)['package']=='speech' else shape_video(value,request) if model_config(request)['package'] in ('wan','hunyuan') else shape_image(value,request)


def stop(request,c):
    import modal
    if request.get('admissionClosed') is not True:raise ValueError('FLUX_ADMISSION_NOT_CLOSED')
    for call_id in request.get('functionCallIds',[]):
        call=modal.FunctionCall.from_id(checked_call_id(call_id),client=c)
        try:call.cancel(terminate_containers=False)
        except Exception:pass
    calls_settled=call_statuses(request)
    before=metadata(request)
    credentials=request['credentials'];env={**os.environ,'MODAL_TOKEN_ID':credentials['tokenId'],'MODAL_TOKEN_SECRET':credentials['tokenSecret']}
    for task_id in before['containerIds']:
        # Same official pinned CLI implementation as ContainerStop(graceful=True):
        # no inference RPC and no SIGINT-triggered automatic rescheduling.
        subprocess.run([sys.executable,'-m','modal','container','stop','--graceful','--yes',task_id],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True,timeout=40)
    after=metadata(request)
    return {'appId':after['appId'],'activeTasks':after['activeTasks'],'cloudStopped':after['activeTasks']==0 and calls_settled and not request.get('pendingUnknown',False),'admissionClosed':True,'ready':False,'startSettled':True,'deploymentRequired':after['deploymentRequired'],'stopMode':'official_cli_graceful_container_stop','recordedProviderUSD':None}


def private_cached_admission(request):
    """Reject invalid private cached scope before any deployment or SDK client."""
    allowed={'qwen-image-edit-2511','wan22-i2v-a14b','hunyuanvideo15','habibi-irq','habibi-egy','habibi-msa'}
    d=request.get('definition') or {}
    if (request.get('action')!='prepare' or request.get('privateReuseVerifiedWeights') is not True
            or request.get('paidApproved') is not True or request.get('credentials',{}).get('expectedWorkspace')!='basm1998ali'
            or d.get('modelId') not in allowed or request.get('missingFiles')!=[]):
        raise ValueError('FLUX_CACHED_PREPARATION_NOT_READY')


def private_cached_preparation(request,inspection,active_tasks,manifest):
    """Reuse existing verification only; never download or invent a hash result."""
    private_cached_admission(request)
    d=request['definition']
    if (type(active_tasks) is not int or active_tasks!=0
            or inspection.get('ready') is not True or inspection.get('deploymentReady') is not True
            or inspection.get('accountId')!=d.get('accountId') or inspection.get('volume')!=d.get('volume')
            or inspection.get('weightPath')!=d.get('weightPath') or inspection.get('revision')!=manifest.get('revision')):
        raise ValueError('FLUX_CACHED_PREPARATION_NOT_READY')
    files=inspection.get('files') or []
    if not manifest.get('files') or any(not any(all(row.get(k)==spec.get(k) for k in ('path','size','sha256')) and row.get('verified') is True and row.get('present') is True for row in files) for spec in manifest['files']):
        raise ValueError('FLUX_CACHED_PREPARATION_NOT_READY')
    total=sum(f['size'] for f in manifest['files'])
    return {'status':'completed','cloudStopped':True,'inspection':inspection,
            'progress':{'completedBytes':total,'totalBytes':total,'completedFiles':len(manifest['files']),
                        'totalFiles':len(manifest['files']),'phase':'reused_verified_READY_and_sizes'},
            'verification':'scoped_READY_attestation_and_sizes_not_fresh_full_file_hash','gpuUsed':False}


def dispatch(request):
    d,manifest=validate(request);action=request['action']
    if request.get('privateReuseVerifiedWeights') is True:private_cached_admission(request)
    c=client(request)
    if action=='inspect':return inspect(request,c)
    if action=='prepare':
        import modal
        deployment=metadata(request)
        if request.get('privateReuseVerifiedWeights') is True and deployment['activeTasks']!=0:
            raise ValueError('FLUX_CACHED_PREPARATION_NOT_READY')
        if deployment['deploymentRequired']:
            config=model_config(request);deploy_module=importlib.import_module(config['package']+'.deploy')
            deploy_packet={**request,'scope':scope(request,'operationId'),'modelRevision':manifest['revision']}
            if config['package']=='latentsync':getattr(deploy_module,config['deployFunction'])(deploy_packet,client=c,paid_approved=True,license_accepted=request.get('licenseAccepted') is True,face_model_rights_approved=request.get('faceModelRightsApproved') is True,rights_evidence=request.get('rightsEvidence',''),usage_mode=request.get('usageMode','commercial'),research_only=request.get('researchOnly') is True)
            else:getattr(deploy_module,config['deployFunction'])(deploy_packet,client=c)
        # Explicit private commissioning may redeploy code after a stopped test
        # while reusing the exact account/engine/revision's verified READY files.
        # Ordinary preparation still performs a fresh full hash scan. No HTTP
        # transport forwards this private flag, and no missing files are allowed.
        if request.get('privateReuseVerifiedWeights') is True:
            inspection=inspect(request,c)
            receipt=private_cached_preparation(request,inspection,metadata(request)['activeTasks'],manifest)
            return receipt
        payload={'scope':scope(request,'operationId'),'paidApproved':True,'modelRevision':manifest['revision'],'manifestFingerprint':request['manifestFingerprint'],'weightPath':d['weightPath'],'modelVolume':d['volume'],'resultsVolume':request['resultsVolume']}
        if model_config(request)['package']=='latentsync':payload.update({'licenseAccepted':request.get('licenseAccepted') is True,'faceModelRightsApproved':request.get('faceModelRightsApproved') is True,'rightsEvidence':request.get('rightsEvidence',''),'usageMode':request.get('usageMode','commercial'),'researchOnly':request.get('researchOnly') is True})
        if model_config(request)['package'] in ('speech','latentsync'):payload['modelId']=d['modelId']
        if model_config(request)['package']=='hunyuan' or d['modelId']=='audar-tts-v1-flash':payload['licenseAccepted']=request.get('licenseAccepted') is True
        if d['modelId']=='audar-tts-v1-flash':payload['codecLicenseAccepted']=request.get('codecLicenseAccepted') is True
        fn=modal.Function.from_name(request['appName'],'prepare_models',client=c,environment_name='main')
        call=fn.spawn(payload);emit('event',{'kind':'function_call','functionCallId':call.object_id})
        return {'status':'submitted','functionCallId':call.object_id,'progress':None,'cloudStopped':False}
    if action=='observe_preparation':
        import modal
        volume=modal.Volume.from_name(request['resultsVolume'],client=c,create_if_missing=False,environment_name='main')
        try:receipt=json.loads(read_small(volume,'preparations/'+request['operationId']+'.json'))
        except Exception:receipt={}
        try:result=observe_call(request,c)
        except TimeoutError:return {'status':'running','progress':{k:receipt[k] for k in ('completedBytes','totalBytes','completedFiles','totalFiles','phase') if k in receipt},'cloudStopped':False}
        except Exception:
            if d['modelId']=='flux2-klein-4b' and preparation_failed(request):
                return {'status':'failed','error':'FLUX_PREPARATION_FAILED','progress':None,'cloudStopped':metadata(request)['activeTasks']==0}
            raise ValueError('FLUX_RESULT_UNCONFIRMED') from None
        if not isinstance(result,dict) or result.get('scope')!=scope(request,'operationId'):raise ValueError('FLUX_RESULT_UNCONFIRMED')
        return {'status':result.get('status','completed'),'error':result.get('error') if result.get('error') in ('SPEECH_CODEC_AUTHORIZATION_REQUIRED','SPEECH_COMPONENT_ACCESS_DENIED','SPEECH_COMPONENT_NOT_FOUND','SPEECH_COMPONENT_ACCESS_UNAVAILABLE') else None,'progress':{k:receipt[k] for k in ('completedBytes','totalBytes','completedFiles','totalFiles','phase') if k in receipt},'cloudStopped':result.get('cloudStopped') is True and metadata(request)['activeTasks']==0,'inspection':inspect(request,c)}
    if action=='cancel_preparation':
        import modal
        modal.FunctionCall.from_id(checked_call_id(request['functionCallId']),client=c).cancel(terminate_containers=True)
        settled=False
        try:observe_call(request,c);settled=True
        except TimeoutError:pass
        except (modal.exception.InputCancellation,modal.exception.FunctionTimeoutError):settled=True
        except Exception:pass
        info=metadata(request)
        return {'status':'cancelled' if settled and info['activeTasks']==0 else 'uncertain','progress':None,'cloudStopped':settled and info['activeTasks']==0}
    if action=='start':
        info=metadata(request)
        if info['deploymentRequired']:raise ValueError('FLUX_DEPLOYMENT_REQUIRED')
        call=cls(request,c).start.spawn(scope(request));emit('event',{'kind':'function_call','functionCallId':call.object_id,'appId':info['appId']})
        return {'functionCallId':call.object_id,'appId':info['appId'],'ready':False,'cloudStopped':False,'activeTasks':info['activeTasks'],'admissionClosed':False,'startSettled':False}
    if action=='observe':
        info=metadata(request);ready=False;settled=False
        ids=list(dict.fromkeys(request.get('functionCallIds',[])+([request['functionCallId']] if request.get('functionCallId') else [])))
        terminal=bool(ids) and call_statuses({**request,'functionCallIds':ids})
        idle_stopped=info['activeTasks']==0 and terminal and not request.get('pendingUnknown',False)
        if info['activeTasks']>0 and request.get('functionCallId'):
            try:ready=check_scope(observe_call(request,c),request,request_required=False).get('ready') is True;settled=True
            except TimeoutError:pass
        closed=request.get('admissionClosed') is True or idle_stopped
        return {'appId':info['appId'],'ready':ready and info['activeTasks']>0 and not closed,'activeTasks':info['activeTasks'],'cloudStopped':idle_stopped,'admissionClosed':closed,'startSettled':settled or terminal,'deploymentRequired':info['deploymentRequired'],'recordedProviderUSD':None}
    if action=='stop':return stop(request,c)
    if action=='cancel_call':return stop({**request,'functionCallIds':[request['functionCallId']]},c)
    if action=='generate':
        value=dict(request['request'])
        if model_config(request)['package']=='latentsync':
            for key in ('audio','video'):
                if key in value:
                    asset=dict(value[key]);value[key+'_bytes']=base64.b64decode(asset.pop('base64'),validate=True);value[key]=asset
        elif model_config(request)['package']=='speech':value['reference_audio']=base64.b64decode(request['referenceAudioBase64'],validate=True)
        else:value['reference_images']=[base64.b64decode(v,validate=True) for v in request.get('referenceImagesBase64',[])]
        call=cls(request,c).generate.spawn(value,scope(request));emit('event',{'kind':'function_call','functionCallId':call.object_id})
        import modal
        results=modal.Volume.from_name(request['resultsVolume'],client=c,create_if_missing=False,environment_name='main')
        last=-1;deadline=time.monotonic()+model_config(request).get('waitSeconds',900)
        while True:
            try:return shape_output(call.get(timeout=2),request)
            except TimeoutError:
                if time.monotonic()>deadline:raise RuntimeError('FLUX_STATE_UNKNOWN')
                try:
                    progress=json.loads(read_small(results,'runs/'+request['runId']+'/progress/'+request['requestId']+'.json'))
                    actual=progress.get('progress',progress)
                    if progress.get('scope')!=scope(request):continue
                    if type(actual.get('completed')) is int and type(actual.get('total')) is int and actual['total']==model_config(request)['steps'] and actual.get('unit')==model_config(request).get('unit','steps') and last<actual['completed']<=model_config(request)['steps']:
                        last=actual['completed'];emit('event',{'kind':'progress','progress':{'completed':last,'total':model_config(request)['steps'],'unit':model_config(request).get('unit','steps')}})
                except Exception:pass
            except Exception:
                if model_config(request)['package']=='latentsync':
                    try:
                        failed=json.loads(read_small(results,'runs/'+request['runId']+'/results/'+request['requestId']+'.json'));code=failed.get('error','')
                        known=failed.get('scope')==scope(request) and failed.get('status')=='failed' and failed.get('needsReview') is True and re.fullmatch(r'LATENTSYNC_(?:FACE|FACE_TRACK|AUDIO_VIDEO_TIMING)_REVIEW_REQUIRED',code)
                    except Exception:known=False
                    if known:raise RuntimeError(code) from None
                raise
    if action=='observe_result':
        import modal
        volume=modal.Volume.from_name(request['resultsVolume'],client=c,create_if_missing=False,environment_name='main')
        prefix='runs/'+request['runId']+'/results/'+request['requestId']
        result=json.loads(read_small(volume,prefix+'.json'))
        if model_config(request)['package']=='latentsync':
            if result.get('operation',(result.get('metadata') or {}).get('operation'))=='lip_sync':result['videoBase64']=base64.b64encode(read_small(volume,prefix+'.mp4',MAX_VIDEO)).decode()
        elif model_config(request)['package']=='speech':result['audioBase64']=base64.b64encode(read_small(volume,prefix+'.wav',MAX_AUDIO)).decode()
        elif model_config(request)['package'] in ('wan','hunyuan'):result['videoBase64']=base64.b64encode(read_small(volume,prefix+'.mp4',MAX_VIDEO)).decode()
        else:result['imageBase64']=base64.b64encode(read_small(volume,prefix+'.png',MAX_IMAGE)).decode()
        return shape_output(result,request)
    raise ValueError('FLUX_ACTION_INVALID')


def main():
    global ACTIVE_MODEL
    line=sys.stdin.readline(128000001)
    if len(line)>128000000:raise ValueError('FLUX_REQUEST_LIMIT')
    request=json.loads(line)
    if len(line)>24000000 and (request.get('definition') or {}).get('modelId')!='latentsync16':raise ValueError('FLUX_REQUEST_LIMIT')
    ACTIVE_MODEL=(request.get('definition') or {}).get('modelId');emit('result',dispatch(request))


if __name__=='__main__':
    try:main()
    except BaseException as error:
        code=str(error) if isinstance(error,(ValueError,RuntimeError)) and re.fullmatch(r'(?:FLUX|QWEN|WAN|HUNYUAN|SPEECH|LATENTSYNC)_[A-Z_]{1,70}',str(error)) else 'FLUX_STATE_UNKNOWN'
        if ACTIVE_MODEL in ('qwen-image-edit-2511','wan22-i2v-a14b','hunyuanvideo15'):code=re.sub(r'^(?:FLUX|WAN)_', {'wan22-i2v-a14b':'WAN_','qwen-image-edit-2511':'QWEN_','hunyuanvideo15':'HUNYUAN_'}[ACTIVE_MODEL],code)
        if ACTIVE_MODEL=='latentsync16':code=re.sub(r'^FLUX_','LATENTSYNC_',code)
        if ACTIVE_MODEL in MODELS and MODELS[ACTIVE_MODEL]['package']=='speech':code=re.sub(r'^FLUX_','SPEECH_',code)
        emit('error',{'code':code});sys.exit(1)
