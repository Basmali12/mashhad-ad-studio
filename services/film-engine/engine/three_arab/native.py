"""Official pinned API, local components only. Imported solely after approval.

Run in its own worker process/image. Monkeypatches scope to that private worker;
never import into an existing Habibi container or shared web process.
"""
import os
from pathlib import Path
import hashlib
import subprocess
from .runtime import manifest,require_native_eligibility

class NativeBackend:
 def __init__(self,root):
  require_native_eligibility()
  root=Path(root)
  os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1',WANDB_DISABLED='true')
  import torch
  if not torch.cuda.is_available():raise RuntimeError('THREE_ARAB_CUDA_REQUIRED')
  import arabic_tts
  source=Path(arabic_tts.__file__).resolve().parent.parent
  revision=subprocess.run(['git','-C',str(source),'rev-parse','HEAD'],capture_output=True,text=True,check=True).stdout.strip()
  clean=subprocess.run(['git','-C',str(source),'diff','--quiet','HEAD','--','arabic_tts'],capture_output=True).returncode==0
  if revision!=manifest()['sourceCommit'] or not clean:raise RuntimeError('THREE_ARAB_SOURCE_CHANGED')
  import arabic_tts.inference_runtime as upstream
  from arabic_tts.inference_runtime import InferenceRuntime,RuntimeKey,SamplingRequest,save_wav
  from arabic_tts.tokenizer import PretrainedTextTokenizer
  from .watermark import AudioSealWatermarker
  # Freeze resolution to the checked local tokenizer. Reject unknown repo IDs.
  original=PretrainedTextTokenizer.from_pretrained.__func__
  def local_tokenizer(cls,repo_id,add_bos=True,local_files_only=True):
   if repo_id!='sherif1313/llm-ar':raise RuntimeError('THREE_ARAB_TOKENIZER_NOT_AUDITED')
   return original(cls,str(root/'tokenizer'),add_bos=add_bos,local_files_only=True)
  PretrainedTextTokenizer.from_pretrained=classmethod(local_tokenizer)
  def local_watermark(*,device,model_type='44.1k'):
   if model_type!='44.1k':raise RuntimeError('THREE_ARAB_WATERMARK_NOT_AUDITED')
   return AudioSealWatermarker(root,device=device)
  # Explicit post-synthesis watermark backend variant in this private worker.
  # No SilentCipher weights are loaded; generated output remains watermarked.
  upstream.SilentCipherWatermarker=local_watermark
  self.torch=torch;self.request_type=SamplingRequest;self.save=save_wav
  self.runtime=InferenceRuntime.from_key(RuntimeKey(checkpoint=str(root/'model/model.safetensors'),model_device='cuda',codec_repo=str(root/'codec/weights.pth'),model_precision='fp32',codec_device='cuda',codec_precision='fp32',compile_model=False))
  if not self.runtime.model_cfg.use_caption_condition or self.runtime.model_cfg.use_duration_predictor:raise RuntimeError('THREE_ARAB_CHECKPOINT_CONFIG_CHANGED')
  if not self.runtime.watermarker.ready:raise RuntimeError('THREE_ARAB_WATERMARK_NOT_READY')
 def synthesize(self,value,target):
  self.torch.manual_seed(value['seed']);self.torch.cuda.manual_seed_all(value['seed'])
  request=self.request_type(text=value['text'],caption=value['caption'],no_ref=True,num_candidates=1,seconds=value['seconds'],num_steps=40,seed=value['seed'],trim_tail=False,context_kv_cache=True)
  self.runtime.watermarker.native_output_path=Path(target).with_name(Path(target).stem+'-prewatermark-f32.wav')
  out=self.runtime.synthesize(request,log_fn=None)
  if out.sample_rate not in (24000,44100,48000) or out.used_seed!=value['seed']:raise RuntimeError('THREE_ARAB_RESULT_INVALID')
  receipts=self.runtime.watermarker.receipts
  if not receipts or receipts[-1].get('detected') is not True:raise RuntimeError('AUDIOSEAL_DETECTION_FAILED')
  self.save(str(target),out.audio,out.sample_rate)
  raw=Path(target).read_bytes()
  source=Path(self.runtime.watermarker.native_output_path)
  source_sha=hashlib.sha256(source.read_bytes()).hexdigest()
  return {'file':str(target),'sha256':hashlib.sha256(raw).hexdigest(),'sampleRate':out.sample_rate,'usedSeed':out.used_seed,'timings':[(('audioseal_watermark' if name=='silentcipher_watermark' else name),seconds) for name,seconds in out.stage_timings],'watermarkRequired':True,'sourceFile':str(source),'sourceSHA256':source_sha,'watermark':receipts[-1],'adapterVariant':'audioseal-v1'}
