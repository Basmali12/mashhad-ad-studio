"""Native environment subprocess. Never imports or controls the Modal SDK."""
import json
from pathlib import Path
import sys

def inspect(root):
 import importlib.metadata as metadata
 import torch,arabic_tts,audioseal,silentcipher
 from .runtime import verify_files
 from .watermark import AudioSealWatermarker
 checked=verify_files(root)
 marker=AudioSealWatermarker(root,device='cpu')
 torch.set_num_threads(2)
 torch.set_num_interop_threads(1)
 import soundfile as sf
 # Existing owner-requested synthetic Habibi output; never a cloning input.
 pcm,rate=sf.read('/root/fixtures/owner-synthetic-narration.wav',dtype='float32')
 carrier=torch.from_numpy(pcm[:rate*2])
 marked=marker.encode_one(carrier,sample_rate=int(rate))
 if marked.shape!=carrier.shape:raise RuntimeError('AUDIOSEAL_SAMPLE_COUNT_CHANGED')
 return {'imports':True,'checked':checked,'watermarkCPUCheck':marker.receipts[-1],'torch':torch.__version__,'audioseal':audioseal.__version__,'omegaconf':metadata.version('omegaconf'),'gpuUsed':False}

def batch(root,request_file):
 from .runtime import ThreeArabRuntime,validate_request
 import torch
 torch.set_num_threads(2)
 torch.set_num_interop_threads(1)
 requests=json.loads(Path(request_file).read_text(encoding='utf-8'))
 if len(requests)!=2 or [r.get('style') for r in requests]!=['solemn','calm'] or requests[0]['text']!=requests[1]['text']:
  raise ValueError('THREE_ARAB_BATCH_SCOPE_INVALID')
 for r in requests:validate_request(r)
 engine=ThreeArabRuntime(root);output=root.parent/'trial2'
 for r in requests:
  result=engine.generate(r,output,approved=True,rights_reviewed=True,execution_id='trial2-'+r['style'])
  print('MASHHAD_SAMPLE_COMPLETED:'+r['style'],flush=True)
 return {'completed':2,'native':True}

if __name__=='__main__':
 try:
  if len(sys.argv) not in (3,4):raise ValueError('NATIVE_WORKER_ARGUMENTS')
  mode=sys.argv[1];root=Path(sys.argv[2])
  if mode=='inspect' and len(sys.argv)==3:result=inspect(root)
  elif mode=='batch' and len(sys.argv)==4:result=batch(root,sys.argv[3])
  else:raise ValueError('NATIVE_WORKER_MODE')
  print('MASHHAD_NATIVE_RESULT:'+json.dumps(result),flush=True)
 except Exception:
  # This isolated process has no API credentials or attached Modal Secrets.
  import traceback
  traceback.print_exc();raise SystemExit(1)
