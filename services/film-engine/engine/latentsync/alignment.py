"""Forced CTC alignment from measured emissions, never word-length timing."""
import math
import re
import unicodedata


def normalize_word(text):
    return ''.join(c for c in unicodedata.normalize('NFC',text) if not unicodedata.category(c).startswith(('P','M','Z')) and c!='ـ')


def align_ctc(log_probs,text,duration_ms,vocab,*,blank_id=0,threshold=0.6):
    """Viterbi over blank-interleaved transcript labels, preserving blank pauses.

    Every returned timestamp comes from an actual emission-frame index. Low
    confidence, impossible paths and unknown characters yield null word times.
    This neither transcribes speech nor verifies that the supplied script was said.
    """
    def review(reason):return {'status':'needs_review','needsReview':True,'words':None,'sentences':None,'segments':None,'durationMs':duration_ms,'confidence':None,'reviewReasons':[reason],'transcriptVerified':False}
    if not isinstance(text,str) or not text.strip() or not isinstance(duration_ms,(int,float)) or duration_ms<=0:return review('ALIGNMENT_INVALID_INPUT')
    source=[w for w in re.findall(r'\S+',text) if normalize_word(w)]
    normalized=[normalize_word(w) for w in source]
    labels=[];word_positions=[]
    for index,word in enumerate(normalized):
        if index:
            if '|' not in vocab:return review('ALIGNMENT_UNSUPPORTED_TOKEN')
            labels.append(vocab['|'])
        positions=[]
        for char in word:
            if char not in vocab:return review('ALIGNMENT_UNSUPPORTED_TOKEN')
            positions.append(len(labels));labels.append(vocab[char])
        word_positions.append(positions)
    if not labels or not log_probs:return review('ALIGNMENT_NO_EMISSIONS')
    frames=len(log_probs);states=[blank_id]
    for token in labels:states.extend([token,blank_id])
    width=len(states)
    if frames*width>12000000:return review('ALIGNMENT_CHUNK_TOO_COMPLEX')
    if any(len(row)<=max(states) or any(not isinstance(v,(int,float)) or not math.isfinite(v) or v>0.0001 for v in row) for row in log_probs):return review('ALIGNMENT_INVALID_EMISSIONS')
    previous=[-math.inf]*width;previous[0]=log_probs[0][blank_id];previous[1]=log_probs[0][states[1]]
    paths=[bytearray([255])*width]
    for frame in range(1,frames):
        current=[-math.inf]*width;trace=bytearray([255])*width
        for state,token in enumerate(states):
            candidates=[(previous[state],0)]
            if state:candidates.append((previous[state-1],1))
            if state>=2 and token!=blank_id and token!=states[state-2]:candidates.append((previous[state-2],2))
            score,step=max(candidates,key=lambda x:x[0])
            if math.isfinite(score):current[state]=score+log_probs[frame][token];trace[state]=step
        paths.append(trace);previous=current
    state=max((width-1,width-2),key=lambda s:previous[s])
    if not math.isfinite(previous[state]):return review('ALIGNMENT_NO_VALID_PATH')
    aligned=[[] for _ in labels]
    for frame in range(frames-1,-1,-1):
        if state%2:aligned[(state-1)//2].append(frame)
        if frame:
            step=paths[frame][state]
            if step==255:return review('ALIGNMENT_NO_VALID_PATH')
            state-=step
    words=[]
    for raw,positions in zip(source,word_positions):
        hits=[f for pos in positions for f in aligned[pos]]
        if not hits or any(not aligned[pos] for pos in positions):return review('ALIGNMENT_MISSING_LABEL')
        confidence=sum(math.exp(log_probs[f][labels[pos]]) for pos in positions for f in aligned[pos])/len(hits)
        words.append({'text':raw,'startMs':round(min(hits)*duration_ms/frames),'endMs':round((max(hits)+1)*duration_ms/frames),'confidence':confidence})
    confidence=sum(w['confidence'] for w in words)/len(words)
    if confidence<threshold or any(w['confidence']<threshold or w['endMs']<=w['startMs'] for w in words):return review('ALIGNMENT_LOW_CONFIDENCE')
    sentences=[];pending=[]
    for index,word in enumerate(words):
        pending.append(word)
        if re.search(r'[.!?؟؛]$',word['text']) or index==len(words)-1:
            sentences.append({'text':' '.join(w['text'] for w in pending),'startMs':pending[0]['startMs'],'endMs':pending[-1]['endMs']});pending=[]
    return {'status':'aligned','needsReview':False,'words':words,'sentences':sentences,'segments':sentences,'durationMs':duration_ms,'confidence':confidence,'reviewReasons':[],'transcriptVerified':False}


class ArabicCTCBackend:
    def __init__(self,root,device='cuda'):
        import torch
        from transformers import Wav2Vec2ForCTC,Wav2Vec2Processor
        self.torch=torch;self.device=device
        self.processor=Wav2Vec2Processor.from_pretrained(str(root/'alignment'),local_files_only=True)
        self.model=Wav2Vec2ForCTC.from_pretrained(str(root/'alignment'),local_files_only=True).eval().to(device)
        self.vocab=self.processor.tokenizer.get_vocab()

    def align(self,audio_path,text,duration_ms):
        import wave
        import numpy as np
        with wave.open(str(audio_path),'rb') as stream:
            if stream.getframerate()!=16000 or stream.getnchannels()!=1 or stream.getsampwidth()!=2:raise ValueError('ALIGNMENT_PCM_REQUIRED')
            audio=np.frombuffer(stream.readframes(stream.getnframes()),dtype='<i2').astype(np.float32)/32768
        inputs=self.processor(audio,sampling_rate=16000,return_tensors='pt',padding=True)
        with self.torch.no_grad():
            kwargs={k:v.to(self.device) for k,v in inputs.items()}
            emissions=self.torch.log_softmax(self.model(**kwargs).logits,dim=-1)[0].cpu().tolist()
        return align_ctc(emissions,text,duration_ms,self.vocab,blank_id=self.processor.tokenizer.pad_token_id)

    def close(self):
        self.model=None;self.processor=None
