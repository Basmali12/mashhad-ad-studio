"""Pinned original BF16 Qwen-Image-Edit-2511. No implicit download or fallback.

Only prepare()/generate() import inference packages. Import and validation are
CPU-only. File hashes are verified by explicit CPU preparation; GPU startup
checks that exact preparation marker and sizes rather than rehashing 53.76 GiB.
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
GUIDANCE=1.0
TRUE_CFG=4.0
MAX_REFERENCE_BYTES=8*1024*1024
ID=re.compile(r'^[A-Za-z0-9_-]{1,100}$')


def manifest_fingerprint():
    return hashlib.sha256(json.dumps(MANIFEST,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()


def validate_scope(scope,engine_id,account_id,runtime_id=None,request_required=False):
    if not isinstance(scope,dict) or set(scope)-{'engineId','accountId','runId','requestId'}:
        raise ValueError('QWEN_SCOPE_MISMATCH')
    if scope.get('engineId')!=engine_id or scope.get('accountId')!=account_id:
        raise ValueError('QWEN_SCOPE_MISMATCH')
    for name in ('engineId','accountId','runId'):
        if not isinstance(scope.get(name),str) or not ID.fullmatch(scope[name]):raise ValueError('QWEN_SCOPE_MISMATCH')
    if runtime_id is not None and scope['runId']!=runtime_id:raise ValueError('QWEN_SCOPE_MISMATCH')
    if (request_required or 'requestId' in scope) and (not isinstance(scope.get('requestId'),str) or not ID.fullmatch(scope['requestId'])):
        raise ValueError('QWEN_SCOPE_MISMATCH')
    return scope


def validate_request(request):
    if not isinstance(request,dict) or set(request)-{'prompt','width','height','seed','mode','reference_images'}:
        raise ValueError('QWEN_INVALID_REQUEST')
    prompt=request.get('prompt')
    if not isinstance(prompt,str) or not prompt.strip() or len(prompt)>12000 or '\x00' in prompt:
        raise ValueError('QWEN_INVALID_PROMPT')
    width,height=request.get('width'),request.get('height')
    if any(type(v) is not int for v in (width,height)) or (width,height) not in ((720,1280),(1280,720)):
        raise ValueError('QWEN_INVALID_DIMENSIONS')
    seed=request.get('seed')
    if type(seed) is not int or seed<0 or seed>4294967295:raise ValueError('QWEN_INVALID_SEED')
    mode=request.get('mode','edit');references=request.get('reference_images',[])
    if mode not in ('edit','multi_reference') or not isinstance(references,list) or not 1<=len(references)<=3:
        raise ValueError('QWEN_INVALID_REFERENCES')
    if mode=='edit' and len(references)!=1 or mode=='multi_reference' and not 2<=len(references)<=3:
        raise ValueError('QWEN_INVALID_REFERENCES')
    for value in references:
        if not isinstance(value,bytes) or not 16<=len(value)<=MAX_REFERENCE_BYTES:
            raise ValueError('QWEN_INVALID_REFERENCES')
        if not (value.startswith(b'\x89PNG\r\n\x1a\n') or value.startswith(b'\xff\xd8\xff') or value[:4]==b'RIFF' and value[8:12]==b'WEBP'):
            raise ValueError('QWEN_INVALID_REFERENCES')
    return {'prompt':prompt.strip(),'width':width,'height':height,'seed':seed,'mode':mode,'reference_images':references}


def verify_local_model(model_dir,expected_scope=None):
    directory=Path(model_dir)
    if not directory.is_dir() or directory.is_symlink() or directory.resolve()!=directory.absolute():
        raise RuntimeError('QWEN_WEIGHTS_NOT_READY')
    marker_path=directory/'READY.json'
    if not marker_path.is_file() or marker_path.is_symlink() or marker_path.stat().st_size>65536:
        raise RuntimeError('QWEN_WEIGHTS_NOT_READY')
    marker=json.loads(marker_path.read_text(encoding='utf-8'))
    if marker.get('modelId')!=MODEL_ID or marker.get('revision')!=MODEL_REVISION or marker.get('manifestFingerprint')!=manifest_fingerprint():
        raise RuntimeError('QWEN_WEIGHTS_NOT_READY')
    if expected_scope and any(marker.get(k)!=expected_scope[k] for k in ('engineId','accountId')):
        raise RuntimeError('QWEN_WEIGHTS_NOT_READY')
    recorded=marker.get('files')
    if not isinstance(recorded,list) or len(recorded)!=len(MANIFEST['files']):raise RuntimeError('QWEN_WEIGHTS_NOT_READY')
    for spec in MANIFEST['files']:
        file=directory/spec['path']
        if not file.is_file() or file.is_symlink() or not file.resolve().is_relative_to(directory.resolve()) or file.stat().st_size!=spec['size']:
            raise RuntimeError('QWEN_WEIGHTS_NOT_READY')
        if not any(row.get('path')==spec['path'] and row.get('size')==spec['size'] and row.get('sha256')==spec['sha256'] for row in recorded):
            raise RuntimeError('QWEN_WEIGHTS_NOT_READY')
    return marker


def load_reference(value):
    from PIL import Image
    with Image.open(io.BytesIO(value)) as image:
        if image.width*image.height>16000000 or image.width<16 or image.height<16:
            raise ValueError('QWEN_INVALID_REFERENCES')
        image.load()
        return image.convert('RGB')


class QwenEditRuntime:
    def __init__(self,model_dir,*,pipeline_factory=None,image_loader=None,generator_factory=None,device='cuda',expected_scope=None,offload=True):
        self.model_dir=Path(model_dir)
        self.pipeline_factory=pipeline_factory
        self.image_loader=image_loader or load_reference
        self.generator_factory=generator_factory
        self.device=device
        self.expected_scope=expected_scope
        self.offload=offload
        self.pipeline=None
        self.torch=None
        self.prepare_seconds=None

    def prepare(self):
        if self.pipeline is not None:return {'ready':True,'modelId':MODEL_ID,'revision':MODEL_REVISION,'loadSeconds':self.prepare_seconds}
        verify_local_model(self.model_dir,self.expected_scope)
        started=time.monotonic()
        if self.pipeline_factory:
            pipeline=self.pipeline_factory(str(self.model_dir),local_files_only=True,torch_dtype='bfloat16',offload=self.offload)
        else:
            import torch
            from diffusers import QwenImageEditPlusPipeline
            if not torch.cuda.is_available() or not torch.cuda.is_bf16_supported():raise RuntimeError('QWEN_CUDA_BF16_UNAVAILABLE')
            pipeline=QwenImageEditPlusPipeline.from_pretrained(str(self.model_dir),torch_dtype=torch.bfloat16,local_files_only=True)
            if self.offload:pipeline.enable_model_cpu_offload()
            else:pipeline.to(self.device)
            self.torch=torch
        self.pipeline=pipeline
        self.prepare_seconds=time.monotonic()-started
        return {'ready':True,'modelId':MODEL_ID,'revision':MODEL_REVISION,'loadSeconds':self.prepare_seconds}

    def generate(self,request,output_dir,on_progress=None):
        value=validate_request(request)
        self.prepare()
        folder=Path(output_dir)
        folder.mkdir(parents=True,exist_ok=True,mode=0o700)
        if folder.is_symlink() or folder.resolve()!=folder.absolute():raise ValueError('QWEN_UNSAFE_OUTPUT')
        output=folder/'image.png';metadata_path=folder/'metadata.json'
        if output.exists() or output.is_symlink() or metadata_path.exists() or metadata_path.is_symlink():raise RuntimeError('QWEN_OUTPUT_ALREADY_EXISTS')
        images=[self.image_loader(v) for v in value['reference_images']]
        generator=self.generator_factory(value['seed']) if self.generator_factory else self.torch.Generator(device=self.device).manual_seed(value['seed']) if self.torch else value['seed']
        if self.torch:
            self.torch.cuda.synchronize();self.torch.cuda.reset_peak_memory_stats()
        started=time.monotonic();reported=[0]
        def callback(pipeline,index,timestep,kwargs):
            completed=int(index)+1
            if not reported[0]<=completed<=STEPS:raise RuntimeError('QWEN_INVALID_PROGRESS')
            reported[0]=completed
            if on_progress:on_progress({'completed':completed,'total':STEPS,'unit':'steps'})
            return kwargs
        args={'prompt':value['prompt'],'width':value['width'],'height':value['height'],'num_inference_steps':STEPS,'guidance_scale':GUIDANCE,'true_cfg_scale':TRUE_CFG,'negative_prompt':' ','num_images_per_prompt':1,'generator':generator,'callback_on_step_end':callback}
        if images:args['image']=images[0] if len(images)==1 else images
        result=self.pipeline(**args)
        if self.torch:self.torch.cuda.synchronize()
        inference_seconds=time.monotonic()-started
        if not getattr(result,'images',None) or len(result.images)!=1:raise RuntimeError('QWEN_INVALID_OUTPUT')
        if reported[0]!=STEPS:raise RuntimeError('QWEN_INCOMPLETE_PROGRESS')
        image=result.images[0]
        if (image.width,image.height)!=(value['width'],value['height']):raise RuntimeError('QWEN_OUTPUT_DIMENSIONS_CHANGED')
        image.save(output,format='PNG')
        data=output.read_bytes()
        if not data.startswith(b'\x89PNG\r\n\x1a\n'):raise RuntimeError('QWEN_INVALID_OUTPUT')
        metadata={'modelId':MODEL_ID,'version':MANIFEST['version'],'revision':MODEL_REVISION,'sourceCommit':MANIFEST['sourceCommit'],'width':image.width,'height':image.height,'seed':value['seed'],'mode':value['mode'],'referenceCount':len(images),'steps':STEPS,'guidanceScale':GUIDANCE,'trueCfgScale':TRUE_CFG,'dtype':'bfloat16','quantization':None,'cpuOffload':self.offload,'loadSeconds':self.prepare_seconds,'inferenceSeconds':inference_seconds,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'peakAllocatedBytes':self.torch.cuda.max_memory_allocated() if self.torch else None,'peakReservedBytes':self.torch.cuda.max_memory_reserved() if self.torch else None}
        if not all(math.isfinite(metadata[k]) for k in ('loadSeconds','inferenceSeconds')):raise RuntimeError('QWEN_INVALID_TIMING')
        with metadata_path.open('x',encoding='utf-8') as stream:json.dump(metadata,stream,sort_keys=True)
        return {'imagePath':str(output),'metadataPath':str(metadata_path),**metadata}
