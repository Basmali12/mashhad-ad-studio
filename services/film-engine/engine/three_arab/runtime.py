"""Caption-based candidate, separate from Habibi. No implicit downloads/retries.

This is not registered/published in the rental/production catalog. A private
administrator runner must consume a scoped approval before calling generate.
"""
import hashlib
import json
import math
from pathlib import Path
import re
import time

ROOT=Path(__file__).resolve().parent
STYLES={
 'solemn':{'label':'دينية مهيبة','demo':'005.wav','caption':'صوت رجل عميق. يتحدث بأسلوب سرد هادئ وجاد في جو مهيب. بسرعة بطيئة قليلاً وبدون تمطيط.'},
 'calm':{'label':'سرد هادئ','demo':'003.wav','caption':'صوت رجل هادئ ومنخفض. يروي القصة بوضوح وبسرعة ثابتة وبطيئة قليلاً، مع وقفات طبيعية.'},
}
def manifest():return json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'))
def require_native_eligibility():
 # Caller approval is not a license grant. Keep mocks usable for local checks,
 # but no real model import/load may bypass unresolved component permission.
 if manifest().get('usageEligibility',{}).get('internalTesting')!='permitted':
  raise RuntimeError('THREE_ARAB_WATERMARK_LICENSE_UNRESOLVED')

def digest(data):return hashlib.sha256(data).hexdigest()
def request_fingerprint(request):return digest(json.dumps(request,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode())

def validate_request(request):
 if not isinstance(request,dict) or set(request)!={'text','style','seed','seconds'}:raise ValueError('THREE_ARAB_REQUEST_INVALID')
 text=request['text'];style=request['style'];seconds=request['seconds'];seed=request['seed']
 if not isinstance(text,str) or not text.strip() or len(text)>600 or len(text.encode())>1400 or re.search(r'[\x00-\x1f\ufffd]|<\||\|>',text):raise ValueError('THREE_ARAB_TEXT_INVALID')
 if not re.search(r'[\u0621-\u064a]',text) or style not in STYLES:raise ValueError('THREE_ARAB_STYLE_INVALID')
 if type(seed) is not int or not 0<=seed<2**32:raise ValueError('THREE_ARAB_SEED_INVALID')
 # V1 does NOT predict duration: its upstream None fallback is 30s. Explicit
 # test windows are estimates requiring listening review, never word-safe claims.
 if type(seconds) not in (int,float) or not math.isfinite(seconds) or not 3<=seconds<=20:raise ValueError('THREE_ARAB_DURATION_REQUIRED')
 return {**request,'caption':STYLES[style]['caption'],'numSteps':40,'numCandidates':1,'trimTail':False,'noReference':True}

def verify_files(root,spec=None):
 root=Path(root);spec=spec or manifest()
 if not root.is_dir() or root.is_symlink() or root.resolve()!=root.absolute():raise RuntimeError('THREE_ARAB_ASSETS_NOT_READY')
 for f in spec['files']:
  p=root/f['path']
  if not p.resolve().is_relative_to(root.resolve()) or p.is_symlink() or not p.is_file() or p.stat().st_size!=f['size']:raise RuntimeError('THREE_ARAB_ASSETS_NOT_READY')
  h=hashlib.sha256()
  with p.open('rb') as stream:
   for block in iter(lambda:stream.read(1024*1024),b''):h.update(block)
  if h.hexdigest()!=f['sha256']:raise RuntimeError('THREE_ARAB_ASSET_CHANGED')
 return {'ready':True,'files':len(spec['files']),'bytes':sum(f['size'] for f in spec['files'])}

class ThreeArabRuntime:
 def __init__(self,root,*,backend_factory=None):self.root=Path(root);self.backend_factory=backend_factory;self.backend=None
 def generate(self,request,output_dir,*,approved=False,rights_reviewed=False,execution_id=None):
  value=validate_request(request)
  if approved is not True or rights_reviewed is not True or not isinstance(execution_id,str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',execution_id):raise RuntimeError('THREE_ARAB_APPROVAL_REQUIRED')
  verify_files(self.root);folder=Path(output_dir)
  folder.mkdir(parents=True,exist_ok=True)
  if folder.is_symlink() or folder.resolve()!=folder.absolute():raise RuntimeError('THREE_ARAB_UNSAFE_OUTPUT')
  claim=folder/(execution_id+'.claim')
  # Never repeat an uncertain/failed/successful native call with this ID.
  with claim.open('x',encoding='utf-8') as f:json.dump({'requestSHA256':request_fingerprint(request),'modelRevision':manifest()['revisions']['sherif1313/3arab-TTS-500M-v1-VoiceDesign']},f)
  started=time.monotonic()
  if self.backend is None:
   if self.backend_factory:self.backend=self.backend_factory(self.root)
   else:
    from .native import NativeBackend
    self.backend=NativeBackend(self.root)
  loaded=time.monotonic();result=self.backend.synthesize(value,folder/(execution_id+'.wav'));finished=time.monotonic()
  row={'executionId':execution_id,'modelId':'3arab-voicedesign-v1','request':request,'caption':value['caption'],'result':result,'loadSeconds':loaded-started,'inferenceSeconds':finished-loaded,'voiceIdentityVerified':False,'pronunciationVerified':False,'listeningApproved':False,'sameAsDemoGuaranteed':False}
  with (folder/(execution_id+'.json')).open('x',encoding='utf-8') as f:json.dump(row,f,ensure_ascii=False)
  return row
