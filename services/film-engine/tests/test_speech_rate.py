"""Native synthesis pacing only; no retiming, weights, GPU or network."""
import io
import wave
import types
import sys
from pathlib import Path
import unittest
import tempfile
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'engine'))
from speech import runtime,backends

class RateTests(unittest.TestCase):
    def test_fixed_profile_cannot_change_native_speed_mid_film(self):
        backend=types.SimpleNamespace(synthesize=lambda **kw:b'\x01\x00'*2400)
        with tempfile.TemporaryDirectory() as folder,patch.object(runtime,'verify_local_model',return_value={}):
            engine=runtime.SpeechRuntime(Path(folder),'habibi-msa',backend_factory=lambda *a,**k:backend,device='cpu')
            engine.generate({**self.request(),'speakingRate':0.97},Path(folder)/'first')
            with self.assertRaisesRegex(ValueError,'SPEECH_PROFILE_CHANGED'):
                engine.generate({**self.request(),'speakingRate':1.05},Path(folder)/'second')
    def test_slow_native_speed_reduces_safe_chunk_bytes(self):
        value=runtime.validate_request({**self.request(),'referenceTranscript':'نص مرجعي واضح.','text':'كلمة '*25,'speakingRate':0.85},'habibi-msa')
        chunks=runtime.split_text(value,'habibi-msa')
        ceiling=int(len(value['referenceTranscript'].encode())/6*(22-6)*0.85)
        self.assertTrue(all(len(c.encode())<=ceiling for c in chunks))
        self.assertEqual(''.join(chunks),value['text'])
    def request(self):
        b=io.BytesIO()
        with wave.open(b,'wb') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(16000);w.writeframes(b'\x01\x00'*96000)
        return dict(text='Exact words',referenceTranscript='Exact licensed reference words.',voiceProfileId='profile-one',voiceProfileFingerprint='a'*64,characterId=None,narrator=True,utteranceId='line-one',locale='ar-MSA',expression='neutral',seed=42,reference_audio=b.getvalue())
    def test_rate_is_bounded_and_cannot_be_boolean_or_nonfinite(self):
        for rate in (0.85,0.9,1,1.15):self.assertEqual(runtime.validate_request({**self.request(),'speakingRate':rate},'habibi-msa')['speakingRate'],rate)
        for rate in (0.1,2,True,float('nan'),float('inf'),'0.9'):
            with self.subTest(rate=rate),self.assertRaisesRegex(ValueError,'SPEECH_INVALID_RATE'):runtime.validate_request({**self.request(),'speakingRate':rate},'habibi-msa')
    def test_habibi_passes_rate_to_native_duration_conditioning_not_audio_stretch(self):
        calls=[]
        def infer(*args,**kwargs):calls.append(kwargs);yield [0.1,0.2],24000
        tensor=types.SimpleNamespace(unsqueeze=lambda dim:object())
        modules={'torch':types.SimpleNamespace(manual_seed=lambda seed:None,from_numpy=lambda value:tensor),'numpy':types.SimpleNamespace(concatenate=lambda values:values[0]),'f5_tts.model':types.SimpleNamespace(DiT=object()),'f5_tts.infer.utils_infer':types.SimpleNamespace(load_model=lambda *args,**kwargs:object(),load_vocoder=lambda **kwargs:object()),'habibi_tts.infer.utils_infer':types.SimpleNamespace(infer_batch_process=infer)}
        with patch.dict(sys.modules,modules),patch.object(backends,'pcm_array',return_value=[0.1]),patch.object(backends,'pcm_bytes',return_value=b'\x01\x00'):
            b=backends.HabibiBackend(Path('/models'),'habibi-msa','cpu');b.synthesize(text='Exact words',reference_audio=b'x',reference_transcript='Reference',expression='neutral',seed=42,speaking_rate=0.9)
        self.assertEqual(calls[0]['speed'],0.9);self.assertIsNone(calls[0]['fix_duration'])

if __name__=='__main__':unittest.main()
