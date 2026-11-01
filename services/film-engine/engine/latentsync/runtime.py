"""Scoped offline-only alignment/lip-sync runtime; no downloads on import."""
import hashlib
import io
import json
import math
from pathlib import Path
import re
import subprocess
import time
import wave

ROOT=Path(__file__).resolve().parent
ID=re.compile(r'^[A-Za-z0-9_-]{1,100}$')
SHA=re.compile(r'^[a-f0-9]{64}$')


def manifest_for(model_id='latentsync16'):
    if model_id!='latentsync16':raise ValueError('LATENTSYNC_INVALID_MODEL')
    return json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'))


def manifest_fingerprint(model_id='latentsync16'):
    return hashlib.sha256(json.dumps(manifest_for(model_id),sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()


def validate_scope(scope,engine_id,account_id,runtime_id=None,request_required=False):
    if not isinstance(scope,dict) or set(scope)-{'engineId','accountId','runId','requestId'} or scope.get('engineId')!=engine_id or scope.get('accountId')!=account_id:raise ValueError('LATENTSYNC_SCOPE_MISMATCH')
    for key in ('engineId','accountId','runId'):
        if not isinstance(scope.get(key),str) or not ID.fullmatch(scope[key]):raise ValueError('LATENTSYNC_SCOPE_MISMATCH')
    if runtime_id is not None and scope['runId']!=runtime_id:raise ValueError('LATENTSYNC_SCOPE_MISMATCH')
    if (request_required or 'requestId' in scope) and not ID.fullmatch(scope.get('requestId','')):raise ValueError('LATENTSYNC_SCOPE_MISMATCH')
    return scope


def wav_info(data):
    if not isinstance(data,bytes) or not 44<=len(data)<=8*1024*1024:raise ValueError('LATENTSYNC_INVALID_AUDIO')
    try:
        with wave.open(io.BytesIO(data),'rb') as stream:
            rate,channels,width,count=stream.getframerate(),stream.getnchannels(),stream.getsampwidth(),stream.getnframes()
            if stream.getcomptype()!='NONE' or rate!=24000 or channels!=1 or width!=2 or len(stream.readframes(count+1))!=count*2:raise ValueError('LATENTSYNC_INVALID_AUDIO')
    except (wave.Error,EOFError):raise ValueError('LATENTSYNC_INVALID_AUDIO') from None
    if not 0<count/rate<=120:raise ValueError('LATENTSYNC_AUDIO_CHUNK_REQUIRED')
    return {'durationMs':round(count*1000/rate),'sampleRate':rate,'numSamples':count,'channels':channels}


def validate_request(request):
    common={'operation','speakerId','characterId','voiceProfileId','seed','audio','audio_bytes'}
    align={'text','utteranceId','locale'};lip={'shotId','faceBindingId','video','video_bytes','targetFace','settings'}
    if not isinstance(request,dict) or request.get('operation') not in ('align','lip_sync') or set(request)-common-(align if request['operation']=='align' else lip):raise ValueError('LATENTSYNC_INVALID_REQUEST')
    for key in ('speakerId','voiceProfileId','utteranceId' if request['operation']=='align' else 'shotId'):
        if not ID.fullmatch(request.get(key,'')):raise ValueError('LATENTSYNC_INVALID_BINDING')
    if request.get('characterId') is not None and not ID.fullmatch(request['characterId']):raise ValueError('LATENTSYNC_INVALID_BINDING')
    if type(request.get('seed')) is not int or not 0<=request['seed']<=4294967295:raise ValueError('LATENTSYNC_INVALID_SEED')
    audio=request.get('audio');data=request.get('audio_bytes')
    if not isinstance(audio,dict) or set(audio)-{'assetId','mime','sha256'} or not ID.fullmatch(audio.get('assetId','')) or audio.get('mime')!='audio/wav' or not SHA.fullmatch(audio.get('sha256','')) or not isinstance(data,bytes) or hashlib.sha256(data).hexdigest()!=audio['sha256']:raise ValueError('LATENTSYNC_AUDIO_CHANGED')
    info=wav_info(data)
    if request['operation']=='align':
        text=request.get('text')
        if not isinstance(text,str) or not text.strip() or len(text)>10000 or '\x00' in text or request.get('locale') not in ('ar-IQ','ar-EG','ar-MSA','ar'):raise ValueError('LATENTSYNC_ALIGNMENT_TEXT_INVALID')
    else:
        if request.get('characterId') is None or not ID.fullmatch(request.get('faceBindingId','')):raise ValueError('LATENTSYNC_FACE_REVIEW_REQUIRED')
        face=request.get('targetFace');video=request.get('video');vdata=request.get('video_bytes')
        if not isinstance(video,dict) or set(video)-{'assetId','mime','sha256'} or not ID.fullmatch(video.get('assetId','')) or video.get('mime')!='video/mp4' or not SHA.fullmatch(video.get('sha256','')) or not isinstance(vdata,bytes) or not 24<=len(vdata)<=64*1024*1024 or vdata[4:8]!=b'ftyp' or hashlib.sha256(vdata).hexdigest()!=video['sha256']:raise ValueError('LATENTSYNC_VIDEO_CHANGED')
        if not isinstance(face,dict) or set(face)-{'trackId','faceCount','characterId','reviewed','sourceVideoSHA256'} or not ID.fullmatch(face.get('trackId','')) or type(face.get('faceCount')) is not int or face['faceCount']!=1 or face.get('characterId')!=request['characterId'] or face.get('reviewed') is not True or face.get('sourceVideoSHA256')!=video['sha256']:raise ValueError('LATENTSYNC_FACE_REVIEW_REQUIRED')
        if request.get('settings')!={'numInferenceSteps':20,'guidanceScale':1.5,'fps':25}:raise ValueError('LATENTSYNC_INVALID_SETTINGS')
        if info['durationMs']>15000:raise ValueError('LATENTSYNC_VIDEO_CHUNK_REQUIRED')
    return {**request,'audioInfo':info}


def verify_local_model(model_dir,expected_scope=None):
    root=Path(model_dir);manifest=manifest_for();marker=root/'READY.json'
    if not root.is_dir() or root.is_symlink() or root.resolve()!=root.absolute() or not marker.is_file() or marker.is_symlink() or marker.stat().st_size>65536:raise RuntimeError('LATENTSYNC_WEIGHTS_NOT_READY')
    value=json.loads(marker.read_text(encoding='utf-8'))
    if value.get('modelId')!='latentsync16' or value.get('revision')!=manifest['revision'] or value.get('manifestFingerprint')!=manifest_fingerprint():raise RuntimeError('LATENTSYNC_WEIGHTS_NOT_READY')
    if expected_scope and any(value.get(k)!=expected_scope[k] for k in ('engineId','accountId')):raise RuntimeError('LATENTSYNC_WEIGHTS_NOT_READY')
    recorded=value.get('files',[])
    if len(recorded)!=len(manifest['files']):raise RuntimeError('LATENTSYNC_WEIGHTS_NOT_READY')
    for spec in manifest['files']:
        p=root/spec['path']
        if not p.is_file() or p.is_symlink() or not p.resolve().is_relative_to(root.resolve()) or p.stat().st_size!=spec['size'] or not any(all(row.get(k)==spec[k] for k in ('path','size','sha256')) for row in recorded):raise RuntimeError('LATENTSYNC_WEIGHTS_NOT_READY')
    for item in value.get('faceFiles',[]):
        p=root/item['path']
        if not p.is_file() or p.is_symlink() or not p.resolve().is_relative_to(root.resolve()) or hashlib.sha256(p.read_bytes()).hexdigest()!=item['sha256']:raise RuntimeError('LATENTSYNC_WEIGHTS_NOT_READY')
    if len(value.get('faceFiles',[]))!=2:raise RuntimeError('LATENTSYNC_FACE_WEIGHTS_NOT_READY')
    rights=value.get('licenses',{})
    if rights.get('usageMode')!='noncommercial_research' or rights.get('researchOnly') is not True:raise RuntimeError('LATENTSYNC_COMMERCIAL_RIGHTS_REQUIRED')
    if rights.get('licenseAccepted') is not True or rights.get('faceModelRightsApproved') is not True or not isinstance(rights.get('rightsEvidence'),str) or not rights['rightsEvidence'].strip():raise RuntimeError('LATENTSYNC_COMMERCIAL_RIGHTS_REQUIRED')
    return value


def resample_audio(source,target):
    subprocess.run(['ffmpeg','-nostdin','-v','error','-y','-i',str(source),'-ar','16000','-ac','1','-c:a','pcm_s16le',str(target)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=60)


class LatentSyncRuntime:
    def __init__(self,model_dir,*,backend_factory=None,device='cuda',expected_scope=None,resampler=resample_audio):
        self.model_dir=Path(model_dir);self.device=device;self.expected_scope=expected_scope;self.factory=backend_factory;self.backend=None;self.operation=None;self.resampler=resampler

    def prepare(self):
        started=time.monotonic();verify_local_model(self.model_dir,self.expected_scope)
        return {'ready':True,'modelRevision':manifest_for()['revision'],'manifestFingerprint':manifest_fingerprint(),'loadSeconds':time.monotonic()-started,'runtimeLoaded':False}

    def _switch(self,operation):
        if self.operation==operation and self.backend is not None:return
        if self.backend is not None:
            close=getattr(self.backend,'close',None)
            if close:close()
            self.backend=None
            import gc
            gc.collect()
            if self.device=='cuda':
                import torch
                torch.cuda.empty_cache()
        if self.factory:self.backend=self.factory(self.model_dir,operation,self.device)
        elif operation=='align':
            from .alignment import ArabicCTCBackend
            self.backend=ArabicCTCBackend(self.model_dir,self.device)
        else:
            from .backend import NativeLatentSyncBackend
            self.backend=NativeLatentSyncBackend(self.model_dir,self.device)
        self.operation=operation

    def generate(self,request,output_dir,on_progress=lambda event:None):
        value=validate_request(request);verify_local_model(self.model_dir,self.expected_scope);folder=Path(output_dir)
        if folder.exists() and (folder.is_symlink() or folder.resolve()!=folder.absolute()):raise ValueError('LATENTSYNC_UNSAFE_OUTPUT')
        folder.mkdir(parents=True,exist_ok=False,mode=0o700);audio=folder/'original.wav';audio.write_bytes(value['audio_bytes']);native=folder/'conditioning.wav';self.resampler(audio,native)
        with wave.open(str(native),'rb') as s:
            if s.getframerate()!=16000 or s.getnchannels()!=1 or s.getsampwidth()!=2 or abs(s.getnframes()/16000*1000-value['audioInfo']['durationMs'])>2:raise ValueError('LATENTSYNC_RESAMPLE_CHANGED_DURATION')
        on_progress({'phase':'input_verified','completed':1,'total':3,'unit':'steps'});self._switch(value['operation']);started=time.monotonic()
        metadata={'operation':value['operation'],'modelId':'latentsync16','version':'1.6','revision':manifest_for()['revision'],'modelRevision':manifest_for()['revision'],'speakerId':value['speakerId'],'characterId':value['characterId'],'voiceProfileId':value['voiceProfileId'],'audioSHA256':value['audio']['sha256'],'durationMs':value['audioInfo']['durationMs'],'transcriptVerified':False}
        if value['operation']=='align':
            alignment=self.backend.align(native,value['text'],value['audioInfo']['durationMs']);metadata.update({'utteranceId':value['utteranceId'],'textSHA256':hashlib.sha256(value['text'].encode()).hexdigest(),'locale':value['locale']});alignment={**metadata,**alignment};result={'operation':'align','alignment':alignment,**metadata}
        else:
            video=folder/'original.mp4';video.write_bytes(value['video_bytes']);out=folder/'synced.mp4';details=self.backend.sync(video,native,audio,out,value['targetFace'],value['settings'],value['seed'],on_progress)
            if not out.is_file() or out.is_symlink() or out.stat().st_size>64*1024*1024:raise RuntimeError('LATENTSYNC_OUTPUT_UNCONFIRMED')
            metadata.update({'shotId':value['shotId'],'faceBindingId':value['faceBindingId'],'videoSHA256':value['video']['sha256'],**details,'needsReview':True,'qualityVerified':False});result={'operation':'lip_sync','videoPath':str(out),'sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'metadata':metadata}
        result['inferenceSeconds']=time.monotonic()-started;on_progress({'phase':'output_recorded','completed':3,'total':3,'unit':'steps'});(folder/'metadata.json').write_text(json.dumps({k:v for k,v in result.items() if k!='videoPath'},ensure_ascii=False),encoding='utf-8');return result
