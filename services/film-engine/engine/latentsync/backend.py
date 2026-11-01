"""Official LatentSync 1.6 API with local-only models and strict face admission."""
import json
import math
from pathlib import Path
import subprocess


def probe_video(path):
    data=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(path)],timeout=30))
    video=next(s for s in data['streams'] if s.get('codec_type')=='video');a,b=video['avg_frame_rate'].split('/');fps=float(a)/float(b)
    return {'durationMs':round(float(data['format']['duration'])*1000),'width':video['width'],'height':video['height'],'fps':fps,'numFrames':int(video.get('nb_frames') or round(float(data['format']['duration'])*fps)),'hasAudio':any(s.get('codec_type')=='audio' for s in data['streams'])}


class SingleFaceDetector:
    """Never download a model pack, select a largest face or infer an identity."""
    def __init__(self,root):
        from insightface.model_zoo import get_model
        face=root/'face'/'extracted';detectors=list(face.glob('det_*.onnx'))
        if len(detectors)!=1 or not (face/'2d106det.onnx').is_file():raise RuntimeError('LATENTSYNC_FACE_WEIGHTS_NOT_READY')
        self.detector=get_model(str(detectors[0]),providers=['CPUExecutionProvider']);self.landmark=get_model(str(face/'2d106det.onnx'),providers=['CPUExecutionProvider'])
        self.detector.prepare(ctx_id=-1,input_size=(512,512),det_thresh=0.5);self.landmark.prepare(ctx_id=-1)

    def __call__(self,frame,threshold=0.5):
        import numpy as np
        from insightface.app.common import Face
        boxes,keypoints=self.detector.detect(frame,max_num=0,metric='default')
        boxes=[(i,b) for i,b in enumerate(boxes) if float(b[4])>=threshold]
        if len(boxes)!=1:raise RuntimeError('LATENTSYNC_FACE_REVIEW_REQUIRED')
        index,bbox=boxes[0];face=Face(bbox=bbox[:4],det_score=bbox[4],kps=None if keypoints is None else keypoints[index]);self.landmark.get(frame,face)
        landmarks=face.landmark_2d_106
        if landmarks is None or tuple(landmarks.shape)!=(106,2) or not np.isfinite(landmarks).all():raise RuntimeError('LATENTSYNC_FACE_REVIEW_REQUIRED')
        return tuple(float(v) for v in bbox[:4]),np.round(landmarks).astype(np.int32)

    def check_video(self,path):
        import cv2
        stream=cv2.VideoCapture(str(path));count=0;previous=None
        try:
            while True:
                ok,frame=stream.read()
                if not ok:break
                box,_=self(frame);count+=1
                if previous:
                    x1,y1=max(previous[0],box[0]),max(previous[1],box[1]);x2,y2=min(previous[2],box[2]),min(previous[3],box[3]);intersection=max(0,x2-x1)*max(0,y2-y1);union=(box[2]-box[0])*(box[3]-box[1])+(previous[2]-previous[0])*(previous[3]-previous[1])-intersection
                    if union<=0 or intersection/union<0.15:raise RuntimeError('LATENTSYNC_FACE_TRACK_REVIEW_REQUIRED')
                previous=box
        finally:stream.release()
        if not count:raise RuntimeError('LATENTSYNC_FACE_REVIEW_REQUIRED')
        return count


class NativeLatentSyncBackend:
    def __init__(self,root,device):
        if device!='cuda':raise RuntimeError('LATENTSYNC_CUDA_REQUIRED')
        self.root=root;self.device=device;self.pipeline=None;self.detector=None

    def _load(self):
        if self.pipeline:return
        import torch
        from diffusers import AutoencoderKL,DDIMScheduler
        from omegaconf import OmegaConf
        from latentsync.models.unet import UNet3DConditionModel
        from latentsync.pipelines.lipsync_pipeline import LipsyncPipeline
        from latentsync.whisper.audio2feature import Audio2Feature
        import latentsync.utils.image_processor as image_processor
        import latentsync.pipelines.lipsync_pipeline as pipeline_module
        from latentsync.utils.util import read_video
        import cv2
        code=Path('/opt/latentsync-upstream');config=OmegaConf.load(code/'configs/unet/stage2_512.yaml')
        scheduler=DDIMScheduler.from_pretrained(str(code/'configs'),local_files_only=True)
        vae=AutoencoderKL.from_pretrained(str(self.root/'vae'),torch_dtype=torch.float16,local_files_only=True);vae.config.scaling_factor=0.18215;vae.config.shift_factor=0
        audio_encoder=Audio2Feature(model_path=str(self.root/'checkpoints/whisper/tiny.pt'),device='cuda',num_frames=config.data.num_frames,audio_feat_length=list(config.data.audio_feat_length))
        # The upstream helper reads the exact local checkpoint, not a remote ID.
        unet,_=UNet3DConditionModel.from_pretrained(OmegaConf.to_container(config.model),str(self.root/'checkpoints/latentsync_unet.pt'),device='cpu')
        unet=unet.to(dtype=torch.float16)
        if self.detector is None:self.detector=SingleFaceDetector(self.root)
        # Override the upstream largest-face/default-pack implementation before
        # it can instantiate or trigger an implicit InsightFace download.
        # Upstream read_video returns RGB; InsightFace consumes BGR. Use the
        # same pixels as the independent precheck, without changing coordinates.
        image_processor.FaceDetector=lambda device='cuda':lambda frame,threshold=0.5:self.detector(cv2.cvtColor(frame,cv2.COLOR_RGB2BGR),threshold)
        # Input is already independently checked at 25 fps. Avoid upstream's
        # cwd-global `temp` deletion and implicit re-encoding on every read.
        pipeline_module.read_video=lambda path,**kwargs:read_video(path,change_fps=False,use_decord=False)
        self.pipeline=LipsyncPipeline(vae=vae,audio_encoder=audio_encoder,unet=unet,scheduler=scheduler).to('cuda');self.config=config;self.code=code
        original_chunks=audio_encoder.feature2chunks
        audio_encoder.feature2chunks=lambda feature_array,fps:original_chunks(feature_array,fps)[:self.expected_frames]
        def no_loop(chunks,frames):
            if len(chunks)>len(frames):raise RuntimeError('LATENTSYNC_AUDIO_VIDEO_TIMING_REVIEW_REQUIRED')
            frames=frames[:len(chunks)];faces,boxes,affines=self.pipeline.affine_transform_video(frames);return frames,faces,boxes,affines
        self.pipeline.loop_video=no_loop

    def sync(self,video,conditioning,original_audio,output,target,settings,seed,on_progress):
        import torch
        import wave
        info=probe_video(video)
        with wave.open(str(original_audio),'rb') as stream:duration=stream.getnframes()/stream.getframerate()
        self.expected_frames=math.ceil(duration*25)
        if info['fps']!=25 or info['numFrames']<self.expected_frames or abs(info['durationMs']-duration*1000)>80 or info['durationMs']>15000:raise RuntimeError('LATENTSYNC_AUDIO_VIDEO_TIMING_REVIEW_REQUIRED')
        if self.detector is None:self.detector=SingleFaceDetector(self.root)
        verified=self.detector.check_video(video)
        if verified!=info['numFrames']:raise RuntimeError('LATENTSYNC_FACE_REVIEW_REQUIRED')
        self._load()
        on_progress({'phase':'face_track_verified','completed':2,'total':3,'unit':'steps'});torch.manual_seed(seed);torch.cuda.manual_seed_all(seed)
        native=output.with_name('native-sync.mp4');self.pipeline(video_path=str(video),audio_path=str(conditioning),video_out_path=str(native),num_frames=self.config.data.num_frames,video_fps=25,audio_sample_rate=16000,num_inference_steps=settings['numInferenceSteps'],guidance_scale=settings['guidanceScale'],weight_dtype=torch.float16,width=512,height=512,mask_image_path=str(self.code/'latentsync/utils/mask.png'),temp_dir=str(output.parent/'native-work'))
        # Preserve the original 24-kHz soundtrack; native 16-kHz audio is solely
        # conditioning. No -shortest, time stretch, speech trim or reverse loop.
        subprocess.run(['ffmpeg','-nostdin','-v','error','-y','-i',str(native),'-i',str(original_audio),'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k',str(output)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=90)
        result=probe_video(output)
        if result['width']!=info['width'] or result['height']!=info['height'] or result['fps']!=25 or abs(result['durationMs']-duration*1000)>100 or not result['hasAudio']:raise RuntimeError('LATENTSYNC_OUTPUT_UNCONFIRMED')
        return {**result,'faceCheck':{'trackId':target['trackId'],'characterId':target['characterId'],'singleFaceEveryFrame':True,'framesChecked':verified,'identityVerified':False},'needsReview':True,'lipSyncVerified':False}

    def close(self):
        self.pipeline=None;self.detector=None
