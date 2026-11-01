"""Publisher-original Wan2.2 dual-expert I2V. BF16 inference, no quantization.

Only prepare()/generate() import inference packages. Import and validation are
CPU-only. File hashes are verified by explicit CPU preparation; GPU startup
checks that exact preparation marker and sizes rather than rehashing 117.54 GiB.
"""
import hashlib
import io
import json
import math
from pathlib import Path
import re
import time

ROOT=Path(__file__).resolve().parent
MANIFEST=json.loads((ROOT/'model-manifest.json').read_text(encoding='utf-8'))
MODEL_ID=MANIFEST['modelId']
MODEL_REVISION=MANIFEST['revision']
STEPS=40
GUIDANCE=3.5
GUIDANCE_2=3.5
MAX_VIDEO_BYTES=64*1024*1024
NEGATIVE_PROMPT="Bright tones, overexposed, static, blurred details, subtitles, paintings, worst quality, low quality, JPEG compression residue, deformed, disfigured, extra fingers, fused fingers, still picture, walking backwards"
MAX_REFERENCE_BYTES=8*1024*1024
ID=re.compile(r'^[A-Za-z0-9_-]{1,100}$')


def manifest_fingerprint():
    return hashlib.sha256(json.dumps(MANIFEST,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()


def validate_scope(scope,engine_id,account_id,runtime_id=None,request_required=False):
    if not isinstance(scope,dict) or set(scope)-{'engineId','accountId','runId','requestId'}:
        raise ValueError('WAN_SCOPE_MISMATCH')
    if scope.get('engineId')!=engine_id or scope.get('accountId')!=account_id:
        raise ValueError('WAN_SCOPE_MISMATCH')
    for name in ('engineId','accountId','runId'):
        if not isinstance(scope.get(name),str) or not ID.fullmatch(scope[name]):raise ValueError('WAN_SCOPE_MISMATCH')
    if runtime_id is not None and scope['runId']!=runtime_id:raise ValueError('WAN_SCOPE_MISMATCH')
    if (request_required or 'requestId' in scope) and (not isinstance(scope.get('requestId'),str) or not ID.fullmatch(scope['requestId'])):
        raise ValueError('WAN_SCOPE_MISMATCH')
    return scope


def validate_request(request):
    if not isinstance(request,dict) or set(request)-{'prompt','width','height','seed','mode','reference_images','num_frames','fps'}:
        raise ValueError('WAN_INVALID_REQUEST')
    prompt=request.get('prompt')
    if not isinstance(prompt,str) or not prompt.strip() or len(prompt)>12000 or '\x00' in prompt:raise ValueError('WAN_INVALID_PROMPT')
    width,height=request.get('width'),request.get('height')
    if any(type(v) is not int for v in (width,height)) or (width,height) not in ((480,832),(832,480),(720,1280),(1280,720)):
        raise ValueError('WAN_INVALID_DIMENSIONS')
    seed=request.get('seed')
    if type(seed) is not int or not 0<=seed<=4294967295:raise ValueError('WAN_INVALID_SEED')
    frames=request.get('num_frames',81);fps=request.get('fps',16)
    # 81 is this service's conservative example-based policy, not an architecture maximum.
    if type(frames) is not int or not 5<=frames<=81 or (frames-1)%4 or type(fps) is not int or fps!=16:
        raise ValueError('WAN_INVALID_TEMPORAL_SETTINGS')
    mode=request.get('mode','image_to_video');references=request.get('reference_images')
    if mode!='image_to_video' or not isinstance(references,list) or len(references)!=1:raise ValueError('WAN_INVALID_REFERENCES')
    value=references[0]
    if not isinstance(value,bytes) or not 16<=len(value)<=MAX_REFERENCE_BYTES:raise ValueError('WAN_INVALID_REFERENCES')
    if not(value.startswith(b'\x89PNG\r\n\x1a\n') or value.startswith(b'\xff\xd8\xff') or value[:4]==b'RIFF' and value[8:12]==b'WEBP'):
        raise ValueError('WAN_INVALID_REFERENCES')
    return {'prompt':prompt.strip(),'width':width,'height':height,'seed':seed,'mode':mode,'reference_images':references,'num_frames':frames,'fps':fps}


def verify_local_model(model_dir,expected_scope=None):
    directory=Path(model_dir)
    if not directory.is_dir() or directory.is_symlink() or directory.resolve()!=directory.absolute():
        raise RuntimeError('WAN_WEIGHTS_NOT_READY')
    marker_path=directory/'READY.json'
    if not marker_path.is_file() or marker_path.is_symlink() or marker_path.stat().st_size>65536:
        raise RuntimeError('WAN_WEIGHTS_NOT_READY')
    marker=json.loads(marker_path.read_text(encoding='utf-8'))
    if marker.get('modelId')!=MODEL_ID or marker.get('revision')!=MODEL_REVISION or marker.get('manifestFingerprint')!=manifest_fingerprint():
        raise RuntimeError('WAN_WEIGHTS_NOT_READY')
    if expected_scope and any(marker.get(k)!=expected_scope[k] for k in ('engineId','accountId')):
        raise RuntimeError('WAN_WEIGHTS_NOT_READY')
    recorded=marker.get('files')
    if not isinstance(recorded,list) or len(recorded)!=len(MANIFEST['files']):raise RuntimeError('WAN_WEIGHTS_NOT_READY')
    for spec in MANIFEST['files']:
        file=directory/spec['path']
        if not file.is_file() or file.is_symlink() or not file.resolve().is_relative_to(directory.resolve()) or file.stat().st_size!=spec['size']:
            raise RuntimeError('WAN_WEIGHTS_NOT_READY')
        if not any(row.get('path')==spec['path'] and row.get('size')==spec['size'] and row.get('sha256')==spec['sha256'] for row in recorded):
            raise RuntimeError('WAN_WEIGHTS_NOT_READY')
    return marker


def load_reference(value):
    from PIL import Image
    with Image.open(io.BytesIO(value)) as image:
        if image.width*image.height>16000000 or image.width<16 or image.height<16:
            raise ValueError('WAN_INVALID_REFERENCES')
        image.load()
        return image.convert('RGB')


def encode_video(frames,output,fps):
    """Encode native frames once; ffprobe verifies actual frame count and silence."""
    import subprocess
    width,height=frames[0].size
    command=['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-n','-f','rawvideo','-pix_fmt','rgb24',
             '-s',f'{width}x{height}','-r',str(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','medium',
             '-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',str(output)]
    process=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    try:
        for frame in frames:process.stdin.write(frame.convert('RGB').tobytes())
        process.stdin.close()
        code=process.wait(timeout=300)
        if code:raise RuntimeError('WAN_VIDEO_ENCODING_FAILED')
    except BaseException:
        process.kill();process.wait();raise RuntimeError('WAN_VIDEO_ENCODING_FAILED') from None
    finally:
        process.stderr.close()
    probe=subprocess.run(['ffprobe','-v','error','-count_frames','-show_entries',
                          'stream=codec_type,width,height,nb_read_frames,avg_frame_rate:format=duration',
                          '-of','json',str(output)],capture_output=True,timeout=60,check=True)
    info=json.loads(probe.stdout);streams=info.get('streams',[])
    video=[v for v in streams if v.get('codec_type')=='video']
    if len(video)!=1 or len(streams)!=1:raise RuntimeError('WAN_INVALID_OUTPUT')
    v=video[0];numerator,denominator=v['avg_frame_rate'].split('/')
    return {'width':v['width'],'height':v['height'],'numFrames':int(v['nb_read_frames']),
            'fps':int(numerator)/int(denominator),'durationMs':float(info['format']['duration'])*1000,'audio':False}


class WanVideoRuntime:
    def __init__(self,model_dir,*,pipeline_factory=None,image_loader=None,generator_factory=None,video_encoder=None,
                 device='cuda',expected_scope=None,offload=True):
        self.model_dir=Path(model_dir);self.pipeline_factory=pipeline_factory
        self.image_loader=image_loader or load_reference;self.generator_factory=generator_factory
        self.video_encoder=video_encoder or encode_video;self.device=device;self.expected_scope=expected_scope
        self.offload=offload;self.pipeline=None;self.torch=None;self.prepare_seconds=None

    def prepare(self):
        if self.pipeline is not None:return {'ready':True,'modelId':MODEL_ID,'revision':MODEL_REVISION,'loadSeconds':self.prepare_seconds}
        verify_local_model(self.model_dir,self.expected_scope);started=time.monotonic()
        if self.pipeline_factory:
            pipeline=self.pipeline_factory(str(self.model_dir),local_files_only=True,torch_dtype='bfloat16',offload=self.offload)
        else:
            import torch
            from diffusers import WanImageToVideoPipeline,AutoencoderKLWan
            if not torch.cuda.is_available() or not torch.cuda.is_bf16_supported():raise RuntimeError('WAN_CUDA_BF16_UNAVAILABLE')
            # Official Diffusers recommends FP32 VAE decoding; experts/text encoder use BF16.
            vae=AutoencoderKLWan.from_pretrained(str(self.model_dir),subfolder='vae',torch_dtype=torch.float32,local_files_only=True)
            pipeline=WanImageToVideoPipeline.from_pretrained(str(self.model_dir),vae=vae,torch_dtype=torch.bfloat16,local_files_only=True)
            if pipeline.transformer is None or pipeline.transformer_2 is None or pipeline.config.boundary_ratio!=0.9:
                raise RuntimeError('WAN_EXPERT_CONFIGURATION_MISMATCH')
            if self.offload:pipeline.enable_model_cpu_offload()
            else:pipeline.to(self.device)
            self.torch=torch
        self.pipeline=pipeline;self.prepare_seconds=time.monotonic()-started
        return {'ready':True,'modelId':MODEL_ID,'revision':MODEL_REVISION,'loadSeconds':self.prepare_seconds}

    def generate(self,request,output_dir,on_progress=None):
        value=validate_request(request);self.prepare();folder=Path(output_dir)
        folder.mkdir(parents=True,exist_ok=True,mode=0o700)
        if folder.is_symlink() or folder.resolve()!=folder.absolute():raise ValueError('WAN_UNSAFE_OUTPUT')
        output=folder/'video.mp4';metadata_path=folder/'metadata.json'
        if output.exists() or output.is_symlink() or metadata_path.exists() or metadata_path.is_symlink():raise RuntimeError('WAN_OUTPUT_ALREADY_EXISTS')
        image=self.image_loader(value['reference_images'][0])
        generator=self.generator_factory(value['seed']) if self.generator_factory else self.torch.Generator(device=self.device).manual_seed(value['seed']) if self.torch else value['seed']
        if self.torch:self.torch.cuda.synchronize();self.torch.cuda.reset_peak_memory_stats()
        started=time.monotonic();reported=[0]
        def callback(pipeline,index,timestep,kwargs):
            completed=int(index)+1
            if not reported[0]<=completed<=STEPS:raise RuntimeError('WAN_INVALID_PROGRESS')
            reported[0]=completed
            if on_progress:on_progress({'completed':completed,'total':STEPS,'unit':'steps'})
            return kwargs
        args={'prompt':value['prompt'],'image':image,'width':value['width'],'height':value['height'],
              'num_frames':value['num_frames'],'num_inference_steps':STEPS,'guidance_scale':GUIDANCE,
              'guidance_scale_2':GUIDANCE_2,'negative_prompt':NEGATIVE_PROMPT,'num_videos_per_prompt':1,
              'output_type':'pil','generator':generator,'callback_on_step_end':callback}
        # PyTorch's native SDPA dispatcher chooses a supported kernel. Do not
        # force quadratic-memory MATH or install an unverified flash-attn extension.
        result=self.pipeline(**args)
        if self.torch:self.torch.cuda.synchronize()
        inference_seconds=time.monotonic()-started
        if reported[0]!=STEPS:raise RuntimeError('WAN_INCOMPLETE_PROGRESS')
        if not getattr(result,'frames',None) or len(result.frames)!=1:raise RuntimeError('WAN_INVALID_OUTPUT')
        frames=result.frames[0]
        if len(frames)!=value['num_frames']:raise RuntimeError('WAN_OUTPUT_FRAME_COUNT_CHANGED')
        if any((v.width,v.height)!=(value['width'],value['height']) for v in frames):raise RuntimeError('WAN_OUTPUT_DIMENSIONS_CHANGED')
        encoding_started=time.monotonic();encoded=self.video_encoder(frames,output,value['fps'])
        expected={'width':value['width'],'height':value['height'],'numFrames':value['num_frames'],'fps':value['fps'],'audio':False}
        if any(encoded.get(k)!=v for k,v in expected.items()) or not isinstance(encoded.get('durationMs'),(int,float)) or abs(encoded['durationMs']-value['num_frames']/value['fps']*1000)>1:
            raise RuntimeError('WAN_ENCODED_VIDEO_MISMATCH')
        if not output.is_file() or output.is_symlink() or not 16<=output.stat().st_size<=MAX_VIDEO_BYTES:raise RuntimeError('WAN_INVALID_OUTPUT')
        data=output.read_bytes()
        if data[4:8]!=b'ftyp':raise RuntimeError('WAN_INVALID_OUTPUT')
        metadata={'modelId':MODEL_ID,'version':MANIFEST['version'],'revision':MODEL_REVISION,'sourceCommit':MANIFEST['sourceCommit'],
                  **expected,'durationMs':encoded['durationMs'],'seed':value['seed'],'mode':value['mode'],'referenceCount':1,
                  'steps':STEPS,'guidanceScale':GUIDANCE,'guidanceScale2':GUIDANCE_2,'dtype':'bfloat16','vaeDtype':'float32',
                  'quantization':None,'attentionBackendPolicy':'pytorch_native_sdpa_auto','cpuOffload':self.offload,
                  'loadSeconds':self.prepare_seconds,'inferenceSeconds':inference_seconds,'encodingSeconds':time.monotonic()-encoding_started,
                  'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),
                  'peakAllocatedBytes':self.torch.cuda.max_memory_allocated() if self.torch else None,
                  'peakReservedBytes':self.torch.cuda.max_memory_reserved() if self.torch else None}
        if not all(math.isfinite(metadata[k]) for k in ('loadSeconds','inferenceSeconds','encodingSeconds')):raise RuntimeError('WAN_INVALID_TIMING')
        with metadata_path.open('x',encoding='utf-8') as stream:json.dump(metadata,stream,sort_keys=True)
        return {'videoPath':str(output),'metadataPath':str(metadata_path),**metadata}
