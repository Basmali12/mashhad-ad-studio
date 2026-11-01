"""Explicit AudioSeal variant; preserves provenance rather than omitting it.

Load only audited local publisher checkpoints. Never downloads a model or
returns unmarked audio after a watermark/detection failure.
"""
from pathlib import Path
import hashlib
import math
from .runtime import manifest

def checked_checkpoint(root,name):
 spec=next(f for f in manifest()['files'] if f['path']=='audioseal/'+name)
 root=Path(root).resolve();p=root/spec['path']
 if p.is_symlink() or not p.resolve().is_relative_to(root) or not p.is_file() or p.stat().st_size!=spec['size']:
  raise RuntimeError('AUDIOSEAL_CHECKPOINT_NOT_READY')
 h=hashlib.sha256()
 with p.open('rb') as stream:
  for block in iter(lambda:stream.read(1024*1024),b''):h.update(block)
 if h.hexdigest()!=spec['sha256']:raise RuntimeError('AUDIOSEAL_CHECKPOINT_CHANGED')
 return p

def headroom_gain(peak):
 if type(peak) not in (int,float) or not math.isfinite(peak) or peak<0:raise RuntimeError('AUDIOSEAL_OUTPUT_INVALID')
 gain=min(1.,.98/peak) if peak else 1.
 if gain<.8:raise RuntimeError('AUDIOSEAL_EXCESSIVE_HEADROOM_REQUIRED')
 return gain

def validate_detection(score,bits):
 # Fixed version payload, never a customer identity or secret.
 expected=[(0x4D53>>i)&1 for i in range(15,-1,-1)]
 if not isinstance(score,(int,float)) or not .8<=score<=1 or bits!=expected:
  raise RuntimeError('AUDIOSEAL_DETECTION_FAILED')
 return {'backend':'audioseal','payloadHex':'4D53','detected':True,'score':score,'sampleCountPreserved':True}

class AudioSealWatermarker:
 def __init__(self,root,*,device):
  generator=checked_checkpoint(root,'generator_base.pth');detector=checked_checkpoint(root,'detector_base.pth')
  import torch
  import audioseal
  from audioseal import AudioSeal
  from torchaudio.functional import resample
  import subprocess
  source=Path(audioseal.__file__).resolve().parents[2]
  rev=subprocess.run(['git','-C',str(source),'rev-parse','HEAD'],capture_output=True,text=True,check=True).stdout.strip()
  clean=subprocess.run(['git','-C',str(source),'diff','--quiet','HEAD','--','src/audioseal'],capture_output=True).returncode==0
  if rev!=manifest()['watermarkSourceCommit'] or not clean:raise RuntimeError('AUDIOSEAL_SOURCE_CHANGED')
  self.torch=torch;self.resample=resample;self.device=device
  self.generator=AudioSeal.load_generator(str(generator),nbits=16,device=device).eval()
  self.detector=AudioSeal.load_detector(str(detector),nbits=16,device=device).eval()
  self.receipts=[]

 @property
 def ready(self):return self.generator is not None and self.detector is not None

 def encode_one(self,audio,*,sample_rate):
  torch=self.torch
  if sample_rate not in (24000,44100,48000) or audio.ndim not in (1,2) or audio.ndim==2 and audio.shape[0]!=1:
   raise RuntimeError('AUDIOSEAL_AUDIO_INVALID')
  with torch.inference_mode():
   x=audio.detach().float().reshape(1,1,-1).to(self.device)
   if not x.numel() or not torch.isfinite(x).all() or x.abs().max()>1:raise RuntimeError('AUDIOSEAL_AUDIO_INVALID')
   if getattr(self,'native_output_path',None):
    import soundfile as sf
    p=Path(self.native_output_path)
    with p.open('xb') as stream:sf.write(stream,x.reshape(-1).cpu().numpy(),sample_rate,format='WAV',subtype='FLOAT')
   # Resample only the watermark branch. Do not replace high-rate speech with
   # a 16kHz speech signal or change its number of samples.
   low=self.resample(x,sample_rate,16000)
   message=torch.tensor([[(0x4D53>>i)&1 for i in range(15,-1,-1)]],device=self.device,dtype=torch.int64)
   delta=self.generator.get_watermark(low,sample_rate=16000,message=message)
   if delta.shape!=low.shape or not torch.isfinite(delta).all():raise RuntimeError('AUDIOSEAL_OUTPUT_INVALID')
   high=self.resample(delta,16000,sample_rate)
   if high.shape[-1]<x.shape[-1]:high=torch.nn.functional.pad(high,(0,x.shape[-1]-high.shape[-1]))
   high=high[...,:x.shape[-1]]
   signal=x.square().mean().item();noise=high.square().mean().item()
   if signal<=0 or noise<=0:raise RuntimeError('AUDIOSEAL_PERTURBATION_INVALID')
   strength=min(1.,math.sqrt(signal*.001/noise))
   high=high*strength;marked=x+high
   if not torch.isfinite(marked).all():raise RuntimeError('AUDIOSEAL_OUTPUT_INVALID')
   gain=headroom_gain(float(marked.abs().max().item()))
   marked=marked*gain
   if marked.abs().max()>1:raise RuntimeError('AUDIOSEAL_OUTPUT_INVALID')
   noise=high.square().mean().item()
   if noise>signal*.00101:raise RuntimeError('AUDIOSEAL_PERTURBATION_INVALID')
   score,bits=self.detector.detect_watermark(self.resample(marked,sample_rate,16000),sample_rate=16000)
   receipt=validate_detection(float(score.reshape(-1)[0].item()),bits.reshape(-1).tolist())
   self.receipts.append({**receipt,'sampleRate':sample_rate,'samples':x.shape[-1],'noiseToSignalRatio':noise/signal,'strengthApplied':strength,'headroomGain':gain})
   return marked.reshape(audio.shape).cpu()

 def encode_batch(self,audios,*,sample_rate):
  return [self.encode_one(audio,sample_rate=sample_rate) for audio in audios]
