"""One explicit owner story narration; cached weights only; no public endpoint."""
from pathlib import Path
import hashlib,json,re
from .modal_trial import build_image,native_command,VOLUME,ROOT
APP='mashhad-story-voice-20261102'

def generate_story(packet):
 import modal
 from .runtime import validate_request,request_fingerprint
 if set(packet)!={'executionId','request'} or not re.fullmatch(r'story-20261102-[a-f0-9]{12}',packet['executionId']):raise ValueError('STORY_SCOPE_INVALID')
 validate_request(packet['request'],maximum_seconds=30)
 base=Path('/models').resolve(strict=True)/'private-three-arab-audioseal-v1'
 assets=base/'assets';folder=base/'films'/packet['executionId']
 if folder.is_symlink() or base.is_symlink() or not folder.resolve().is_relative_to(base.resolve()):raise ValueError('STORY_PATH_INVALID')
 folder.mkdir(parents=True,exist_ok=True)
 receipt=folder/(packet['executionId']+'.json');wav=folder/(packet['executionId']+'.wav');claim=folder/'dispatch-claim.json'
 if receipt.exists():
  row=json.loads(receipt.read_text());raw=wav.read_bytes()
  if row['request']!=packet['request'] or hashlib.sha256(raw).hexdigest()!=row['result']['sha256']:raise ValueError('STORY_REPLAY_CHANGED')
  return {'receipt':row,'wavBytes':raw,'reused':True}
 with claim.open('x') as f:json.dump({'requestSHA256':request_fingerprint(packet['request'])},f)
 request=folder/'request.json';request.write_text(json.dumps(packet,ensure_ascii=False),encoding='utf8')
 volume=modal.Volume.from_name(VOLUME,create_if_missing=False);volume.commit()
 try:
  result=native_command('story',assets,request,timeout=150)
  if result.returncode:raise RuntimeError('STORY_NATIVE_FAILED')
 finally:volume.commit()
 row=json.loads(receipt.read_text());raw=wav.read_bytes()
 if row['request']!=packet['request'] or hashlib.sha256(raw).hexdigest()!=row['result']['sha256']:raise ValueError('STORY_RESULT_CHANGED')
 return {'receipt':row,'wavBytes':raw,'reused':False}

def build_story_voice(sdk=None):
 if sdk is None:import modal as sdk
 volume=sdk.Volume.from_name(VOLUME,create_if_missing=False)
 app=sdk.App(APP)
 generation=app.function(image=build_image(sdk),volumes={'/models':volume},gpu='L40S',cpu=2,memory=16384,timeout=180,startup_timeout=180,retries=0,max_containers=1,min_containers=0,scaledown_window=2)(generate_story)
 return app,generation
