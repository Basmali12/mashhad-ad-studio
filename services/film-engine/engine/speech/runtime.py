"""Habibi specialized / Audar Flash. PCM evidence, explicit references, no ASR."""
import hashlib
import io
import json
import math
from pathlib import Path
import re
import time
import wave

ROOT=Path(__file__).resolve().parent
MODEL_IDS=('habibi-irq','habibi-egy','habibi-msa','audar-tts-v1-flash')
TAGS=('laughs','curious','excited','sighs','exhales','mischievously','whispers','sarcastic')
LOCALES={'habibi-irq':('ar-IQ',),'habibi-egy':('ar-EG',),'habibi-msa':('ar-MSA',),
         'audar-tts-v1-flash':('ar','ar-MSA','ar-EG','ar-SA','ar-AE','ar-LB','ar-MA','en','ar-IQ')}
ID=re.compile(r'^[A-Za-z0-9_-]{1,100}$')
SHA=re.compile(r'^[a-f0-9]{64}$')
MAX_WAV_BYTES=8*1024*1024


def manifest_for(model_id):
    if model_id not in MODEL_IDS:raise ValueError('SPEECH_INVALID_MODEL')
    return json.loads((ROOT/'manifests'/(model_id+'.json')).read_text(encoding='utf-8'))


def manifest_fingerprint(model_id):
    return hashlib.sha256(json.dumps(manifest_for(model_id),sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()


def validate_scope(scope,engine_id,account_id,runtime_id=None,request_required=False):
    if not isinstance(scope,dict) or set(scope)-{'engineId','accountId','runId','requestId'}:raise ValueError('SPEECH_SCOPE_MISMATCH')
    if scope.get('engineId')!=engine_id or scope.get('accountId')!=account_id:raise ValueError('SPEECH_SCOPE_MISMATCH')
    for name in ('engineId','accountId','runId'):
        if not isinstance(scope.get(name),str) or not ID.fullmatch(scope[name]):raise ValueError('SPEECH_SCOPE_MISMATCH')
    if runtime_id is not None and scope['runId']!=runtime_id:raise ValueError('SPEECH_SCOPE_MISMATCH')
    if (request_required or 'requestId' in scope) and (not isinstance(scope.get('requestId'),str) or not ID.fullmatch(scope['requestId'])):raise ValueError('SPEECH_SCOPE_MISMATCH')
    return scope


def wav_info(data,*,reference=False):
    if not isinstance(data,bytes) or not 44<=len(data)<=(1024*1024 if reference else MAX_WAV_BYTES):raise ValueError('SPEECH_INVALID_WAV')
    try:
        with wave.open(io.BytesIO(data),'rb') as stream:
            rate,channels,width,count=stream.getframerate(),stream.getnchannels(),stream.getsampwidth(),stream.getnframes()
            if stream.getcomptype()!='NONE' or channels!=1 or width!=2 or rate!=(16000 if reference else 24000):raise ValueError('SPEECH_INVALID_WAV')
            if len(stream.readframes(count+1))!=count*2:raise ValueError('SPEECH_INVALID_WAV')
    except (wave.Error,EOFError):raise ValueError('SPEECH_INVALID_WAV') from None
    seconds=count/rate
    if not(5<=seconds<=12 if reference else 0<seconds<=120):raise ValueError('SPEECH_INVALID_WAV_DURATION')
    return {'sampleRate':rate,'channels':channels,'sampleWidth':width,'numSamples':count,'durationMs':seconds*1000,'format':'pcm_s16le'}


def validate_request(request,model_id):
    manifest_for(model_id)
    allowed={'text','referenceTranscript','voiceProfileId','voiceProfileFingerprint','characterId','narrator','utteranceId','locale','expression','seed','reference_audio','referenceSHA256','speakingRate'}
    if not isinstance(request,dict) or set(request)-allowed:raise ValueError('SPEECH_INVALID_REQUEST')
    text=request.get('text');transcript=request.get('referenceTranscript')
    if not isinstance(text,str) or not text.strip() or len(text)>600 or len(text.encode())>1200 or any(v in text for v in ('\x00','[',']','<|','|>')):raise ValueError('SPEECH_INVALID_TEXT')
    if not re.search(r'[^\W\d_]',text,re.UNICODE):raise ValueError('SPEECH_VOCAL_EVENT_UNSUPPORTED')
    if not isinstance(transcript,str) or not transcript.strip() or len(transcript)>2000 or any(v in transcript for v in ('\x00','<|','|>')):raise ValueError('SPEECH_REFERENCE_TRANSCRIPT_REQUIRED')
    for key in ('voiceProfileId','utteranceId'):
        if not isinstance(request.get(key),str) or not ID.fullmatch(request[key]):raise ValueError('SPEECH_INVALID_PROFILE')
    if not isinstance(request.get('voiceProfileFingerprint'),str) or not SHA.fullmatch(request['voiceProfileFingerprint']):raise ValueError('SPEECH_INVALID_PROFILE')
    character=request.get('characterId');narrator=request.get('narrator')
    if type(narrator) is not bool or (character is not None and(not isinstance(character,str) or not ID.fullmatch(character))) or narrator==(character is not None):raise ValueError('SPEECH_INVALID_SPEAKER')
    seed=request.get('seed')
    if type(seed) is not int or not 0<=seed<=4294967295:raise ValueError('SPEECH_INVALID_SEED')
    rate=request.get('speakingRate',1)
    if type(rate) not in (int,float) or not math.isfinite(rate) or not 0.85<=rate<=1.15 or model_id=='audar-tts-v1-flash' and rate!=1:raise ValueError('SPEECH_INVALID_RATE')
    locale=request.get('locale');expression=request.get('expression','neutral')
    if locale not in LOCALES[model_id]:raise ValueError('SPEECH_UNSUPPORTED_LOCALE')
    if expression!='neutral' and (model_id!='audar-tts-v1-flash' or expression not in TAGS):raise ValueError('SPEECH_UNSUPPORTED_EXPRESSION')
    reference=request.get('reference_audio');info=wav_info(reference,reference=True);reference_hash=hashlib.sha256(reference).hexdigest()
    if request.get('referenceSHA256',reference_hash)!=reference_hash:raise ValueError('SPEECH_REFERENCE_CHANGED')
    return {**request,'text':text,'referenceTranscript':transcript,'expression':expression,'referenceSHA256':reference_hash,'referenceDurationMs':info['durationMs']}


def verify_local_model(model_dir,model_id,expected_scope=None):
    root=Path(model_dir);manifest=manifest_for(model_id);marker=root/'READY.json'
    if not root.is_dir() or root.is_symlink() or root.resolve()!=root.absolute() or not marker.is_file() or marker.is_symlink() or marker.stat().st_size>65536:raise RuntimeError('SPEECH_WEIGHTS_NOT_READY')
    value=json.loads(marker.read_text())
    if value.get('modelId')!=model_id or value.get('revision')!=manifest['revision'] or value.get('manifestFingerprint')!=manifest_fingerprint(model_id):raise RuntimeError('SPEECH_WEIGHTS_NOT_READY')
    if expected_scope and any(value.get(k)!=expected_scope[k] for k in ('engineId','accountId')):raise RuntimeError('SPEECH_WEIGHTS_NOT_READY')
    recorded=value.get('files',[])
    if not isinstance(recorded,list) or len(recorded)!=len(manifest['files']):raise RuntimeError('SPEECH_WEIGHTS_NOT_READY')
    for spec in manifest['files']:
        file=root/spec['path']
        if not file.is_file() or file.is_symlink() or not file.resolve().is_relative_to(root.resolve()) or file.stat().st_size!=spec['size'] or not any(all(row.get(k)==spec[k] for k in ('path','size','sha256')) for row in recorded):raise RuntimeError('SPEECH_WEIGHTS_NOT_READY')
    return value


def split_text(value,model_id):
    text=value['text'];max_bytes=120 if model_id.startswith('habibi-') else 800;max_chars=200
    if model_id.startswith('habibi-'):
        seconds=value['referenceDurationMs']/1000
        max_bytes=min(max_bytes,int(len(value['referenceTranscript'].encode())/seconds*(22-seconds)*value.get('speakingRate',1)))
        if max_bytes<4:raise ValueError('SPEECH_REFERENCE_TEXT_TOO_SHORT')
    chunks=[];current=''
    for word in re.findall(r'\s*\S+\s*',text):
        candidate=current+word
        if len(word.encode())>max_bytes or len(word)>max_chars:raise ValueError('SPEECH_TEXT_CHUNK_TOO_LONG')
        if current and(len(candidate.encode())>max_bytes or len(candidate)>max_chars):chunks.append(current);current=word
        else:current=candidate
    if current:chunks.append(current)
    if ''.join(chunks)!=text:raise ValueError('SPEECH_TEXT_CHUNK_MISMATCH')
    if not 1<=len(chunks)<=16:raise ValueError('SPEECH_TOO_MANY_CHUNKS')
    return chunks


class SpeechRuntime:
    def __init__(self,model_dir,model_id,*,backend_factory=None,device='cuda',expected_scope=None):
        self.model_dir=Path(model_dir);self.model_id=model_id;self.manifest=manifest_for(model_id)
        if device not in ('cuda','cpu'):raise ValueError('SPEECH_INVALID_DEVICE')
        self.device=device;self.expected_scope=expected_scope;self.backend_factory=backend_factory;self.backend=None;self.load_seconds=None;self.bindings={}

    def prepare(self):
        if self.backend is not None:return {'ready':True,'modelId':self.model_id,'revision':self.manifest['revision'],'loadSeconds':self.load_seconds}
        verify_local_model(self.model_dir,self.model_id,self.expected_scope);started=time.monotonic()
        if self.backend_factory:self.backend=self.backend_factory(self.model_dir,self.model_id,device=self.device)
        else:
            from .backends import load_backend
            self.backend=load_backend(self.model_dir,self.model_id,self.device)
        self.load_seconds=time.monotonic()-started
        return {'ready':True,'modelId':self.model_id,'revision':self.manifest['revision'],'loadSeconds':self.load_seconds}

    def generate(self,request,output_dir,on_progress=None):
        value=validate_request(request,self.model_id);chunks=split_text(value,self.model_id)
        binding=(value['voiceProfileFingerprint'],value['referenceSHA256'],value['referenceTranscript'],value['locale'],value.get('speakingRate',1))
        if value['voiceProfileId'] in self.bindings and self.bindings[value['voiceProfileId']]!=binding:raise ValueError('SPEECH_PROFILE_CHANGED')
        self.bindings[value['voiceProfileId']]=binding
        folder=Path(output_dir);folder.mkdir(parents=True,exist_ok=True,mode=0o700)
        if folder.is_symlink() or folder.resolve()!=folder.absolute():raise ValueError('SPEECH_UNSAFE_OUTPUT')
        target=folder/'audio.wav';metadata_file=folder/'metadata.json'
        if target.exists() or target.is_symlink() or metadata_file.exists() or metadata_file.is_symlink():raise RuntimeError('SPEECH_OUTPUT_ALREADY_EXISTS')
        self.prepare();started=time.monotonic();pcm=bytearray();boundaries=[]
        for index,text in enumerate(chunks):
            rate_args={'speaking_rate':value['speakingRate']} if 'speakingRate' in value else {}
            audio=self.backend.synthesize(text=text,reference_audio=value['reference_audio'],reference_transcript=value['referenceTranscript'],expression=value['expression'],seed=(value['seed']+index)%4294967296,**rate_args)
            if not isinstance(audio,bytes) or not audio or len(audio)%2:raise RuntimeError('SPEECH_INVALID_PCM')
            start=len(pcm)//2;pcm.extend(audio);end=len(pcm)//2
            if len(pcm)>24000*2*120:raise RuntimeError('SPEECH_OUTPUT_DURATION_LIMIT')
            boundaries.append({'index':index,'startSample':start,'endSample':end})
            if on_progress:on_progress({'completed':index+1,'total':len(chunks),'unit':'chunks'})
        buffer=io.BytesIO()
        with wave.open(buffer,'wb') as stream:stream.setnchannels(1);stream.setsampwidth(2);stream.setframerate(24000);stream.writeframes(pcm)
        data=buffer.getvalue();info=wav_info(data)
        with target.open('xb') as stream:stream.write(data)
        proof={k:value[k] for k in ('voiceProfileId','voiceProfileFingerprint','characterId','narrator','utteranceId','locale','expression','seed')}
        if 'speakingRate' in value:proof['speakingRate']=value['speakingRate']
        metadata={**proof,**info,'modelId':self.model_id,'version':self.manifest['version'],'revision':self.manifest['revision'],
                  'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'referenceSHA256':value['referenceSHA256'],
                  'referenceTranscriptSHA256':hashlib.sha256(value['referenceTranscript'].encode()).hexdigest(),'textSHA256':hashlib.sha256(value['text'].encode()).hexdigest(),
                  'loadSeconds':self.load_seconds,'inferenceSeconds':time.monotonic()-started,'chunks':boundaries,'wordTimestamps':None,'device':self.device}
        if not all(math.isfinite(metadata[k]) for k in ('loadSeconds','inferenceSeconds')):raise RuntimeError('SPEECH_INVALID_TIMING')
        with metadata_file.open('x',encoding='utf8') as stream:json.dump(metadata,stream,sort_keys=True)
        return {'audioPath':str(target),'metadataPath':str(metadata_file),**metadata}
