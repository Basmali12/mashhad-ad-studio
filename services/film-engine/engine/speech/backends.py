"""Pinned official APIs with explicit local components. No ASR or remote models.

NeuCodec's upstream constructor downloads w2v-BERT implicitly and upstream
from_pretrained only accepts remote IDs. LocalNeuCodec reproduces that pinned
constructor's architecture while loading its two dependencies explicitly offline.
"""
import io
from pathlib import Path
import re
import wave


def habibi_target_text(reference_transcript, text):
    """Match upstream benchmark boundary handling without rewriting either text.

    infer_batch_process adds a separator after an ASCII-ended reference itself;
    an Arabic-ended reference needs a leading target separator instead.
    """
    if reference_transcript and not reference_transcript[-1].isspace() and len(reference_transcript[-1].encode('utf-8')) != 1 and text and not text[0].isspace():
        return ' ' + text
    return text


def pcm_array(data):
    import numpy as np
    with wave.open(io.BytesIO(data),'rb') as stream:return np.frombuffer(stream.readframes(stream.getnframes()),dtype='<i2').astype(np.float32)/32768


def pcm_bytes(value):
    import numpy as np
    value=np.asarray(value,dtype=np.float32)
    if value.ndim!=1 or not value.size or not np.isfinite(value).all():raise RuntimeError('SPEECH_INVALID_PCM')
    return (np.clip(value,-1,1)*32767).round().astype('<i2').tobytes()


def load_local_codec(root,device):
    import torch
    from transformers import Wav2Vec2BertModel,AutoFeatureExtractor
    from neucodec.model import NeuCodec,SemanticEncoder,CodecEncoder,CodecDecoderVocos
    class LocalNeuCodec(NeuCodec):
        def __init__(self):
            torch.nn.Module.__init__(self);self.sample_rate=24000;self.hop_length=480
            self.semantic_model=Wav2Vec2BertModel.from_pretrained(str(root/'semantic'),output_hidden_states=True,local_files_only=True)
            self.feature_extractor=AutoFeatureExtractor.from_pretrained(str(root/'semantic'),local_files_only=True)
            self.SemanticEncoder_module=SemanticEncoder(1024,1024,1024);self.CodecEnc=CodecEncoder()
            self.generator=CodecDecoderVocos(hop_length=480);self.fc_prior=torch.nn.Linear(2048,2048);self.fc_post_a=torch.nn.Linear(2048,1024)
    codec=LocalNeuCodec()
    state=torch.load(root/'codec/pytorch_model.bin',map_location='cpu',weights_only=True)
    state={k:v for k,v in state.items() if not any(skip in k for skip in ('fc_post_s','SemanticDecoder'))}
    incompatible=codec.load_state_dict(state,strict=False)
    if incompatible.unexpected_keys or any(not k.startswith('semantic_model.') for k in incompatible.missing_keys):raise RuntimeError('SPEECH_CODEC_ARCHITECTURE_MISMATCH')
    return codec.eval().to(device)


class HabibiBackend:
    def __init__(self,root,model_id,device):
        import torch
        from f5_tts.model import DiT
        from f5_tts.infer.utils_infer import load_model,load_vocoder
        from habibi_tts.infer.utils_infer import infer_batch_process
        self.torch=torch;self.infer=infer_batch_process;self.device=device
        dialect=model_id.split('-')[-1].upper();step=200000 if dialect=='MSA' else 100000
        arch={'dim':1024,'depth':22,'heads':16,'ff_mult':2,'text_dim':512,'text_mask_padding':True,'qk_norm':None,'conv_layers':4,'pe_attn_head':None,'attn_backend':'torch','attn_mask_enabled':False,'checkpoint_activations':False}
        self.model=load_model(DiT,arch,str(root/f'habibi/Specialized/{dialect}/model_{step}.safetensors'),mel_spec_type='vocos',vocab_file=str(root/f'habibi/Specialized/{dialect}/vocab.txt'),device=device)
        self.vocoder=load_vocoder(vocoder_name='vocos',is_local=True,local_path=str(root/'vocos'),device=device)

    def synthesize(self,*,text,reference_audio,reference_transcript,expression,seed,speaking_rate=1):
        import numpy as np
        torch=self.torch;torch.manual_seed(seed)
        if self.device=='cuda':torch.cuda.manual_seed_all(seed)
        reference=torch.from_numpy(pcm_array(reference_audio)).unsqueeze(0)
        # Supplied transcript is mandatory; never call preprocess_ref_audio_text
        # (which can trim a reference or silently launch Whisper transcription).
        chunks=self.infer((reference,16000),reference_transcript,[habibi_target_text(reference_transcript,text)],self.model,self.vocoder,mel_spec_type='vocos',progress=None,
                          target_rms=0.1,cross_fade_duration=0,nfe_step=32,cfg_strength=2.0,sway_sampling_coef=-1,
                          speed=speaking_rate,fix_duration=None,device=self.device,streaming=True,chunk_size=2048,dialect_id=None)
        waves=[]
        for samples,rate in chunks:
            if rate!=24000:raise RuntimeError('SPEECH_SAMPLE_RATE_CHANGED')
            waves.append(samples)
        if not waves:raise RuntimeError('SPEECH_EMPTY_OUTPUT')
        return pcm_bytes(np.concatenate(waves))


class AudarBackend:
    def __init__(self,root,device):
        import torch
        from transformers import AutoTokenizer,AutoModelForCausalLM
        from audar_tts import build_prompt,encode_reference,GEN_DEFAULTS
        self.torch=torch;self.device=device;self.build_prompt=build_prompt;self.encode_reference=encode_reference;self.defaults=GEN_DEFAULTS
        self.tokenizer=AutoTokenizer.from_pretrained(str(root/'audar/transformers'),local_files_only=True)
        self.model=AutoModelForCausalLM.from_pretrained(str(root/'audar/transformers'),torch_dtype=torch.bfloat16 if device=='cuda' else torch.float32,local_files_only=True).eval().to(device)
        self.codec=load_local_codec(root,device)

    def synthesize(self,*,text,reference_audio,reference_transcript,expression,seed):
        torch=self.torch;torch.manual_seed(seed)
        if self.device=='cuda':torch.cuda.manual_seed_all(seed)
        reference=self.encode_reference(self.codec,pcm_array(reference_audio))
        target=text if expression=='neutral' else '['+expression+'] '+text
        prompt=self.build_prompt(target,reference_transcript,reference)
        ids=self.tokenizer.encode(prompt,add_special_tokens=False,return_tensors='pt').to(self.model.device)
        if ids.shape[1]>6000:raise ValueError('SPEECH_CONTEXT_LIMIT')
        end=self.tokenizer.convert_tokens_to_ids('<|TARGET_CODES_END|>')
        with torch.no_grad():out=self.model.generate(ids,max_new_tokens=1500,eos_token_id=end,pad_token_id=151643,**self.defaults)
        tokens=out[0,ids.shape[1]:]
        if end not in tokens.tolist():raise RuntimeError('SPEECH_TOKEN_LIMIT_REACHED')
        decoded=self.tokenizer.decode(tokens,skip_special_tokens=False);codes=[int(v) for v in re.findall(r'<\|speech_(\d+)\|>',decoded)]
        if not codes:raise RuntimeError('SPEECH_EMPTY_OUTPUT')
        with torch.no_grad():audio=self.codec.decode_code(torch.tensor(codes)[None,None,:].to(next(self.codec.parameters()).device))
        return pcm_bytes(audio.detach().cpu().numpy()[0,0,:])


def load_backend(root,model_id,device):
    import torch
    if device=='cuda' and not torch.cuda.is_available():raise RuntimeError('SPEECH_CUDA_UNAVAILABLE')
    return HabibiBackend(Path(root),model_id,device) if model_id.startswith('habibi-') else AudarBackend(Path(root),device)
