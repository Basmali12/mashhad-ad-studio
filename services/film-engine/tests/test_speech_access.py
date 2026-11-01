"""Metadata-only access contract tests. No HF credentials or network requests."""
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'engine'))
from speech.access import access_error,verify_component_access
from speech.runtime import manifest_for,verify_local_model


class AccessTests(unittest.TestCase):
    def spec(self):
        manifest=manifest_for('audar-tts-v1-flash')
        return next(s for s in manifest['files'] if s.get('gated'))

    def test_official_codec_identity_and_all_offline_runtime_components_are_pinned(self):
        manifest=manifest_for('audar-tts-v1-flash');codec=self.spec()
        self.assertEqual(codec['repoId'],'neuphonic/neucodec')
        self.assertEqual(codec['revision'],manifest['codecRevision'])
        self.assertEqual(codec['path'],'codec/pytorch_model.bin')
        self.assertEqual(codec['sourcePath'],'pytorch_model.bin')
        self.assertTrue({'semantic/config.json','semantic/model.safetensors','semantic/preprocessor_config.json','codec/pytorch_model.bin'}.issubset({s['path'] for s in manifest['files']}))
        self.assertEqual(sum(s['size'] for s in manifest['files']),manifest['totalBytes'])
        self.assertTrue(all(len(s['revision'])==40 and len(s['sha256'])==64 for s in manifest['files']))

    def test_metadata_success_is_scoped_and_does_not_expose_token_or_signed_location(self):
        spec=self.spec();calls=[]
        def metadata(url,**kwargs):
            calls.append((url,kwargs));return types.SimpleNamespace(size=spec['size'],commit_hash=spec['revision'],location='https://sensitive.example/signed-token')
        result=verify_component_access(spec,'synthetic-secret',metadata=metadata)
        self.assertEqual(result['status'],'authorized');self.assertEqual(result['revision'],spec['revision'])
        self.assertEqual(calls[0][1],{'token':'synthetic-secret','timeout':20})
        self.assertNotIn('synthetic-secret',json.dumps(result));self.assertNotIn('sensitive',json.dumps(result))

    def test_auth_not_found_and_network_errors_are_separate_safe_codes(self):
        for status,expected in [(401,'SPEECH_CODEC_AUTHORIZATION_REQUIRED'),(403,'SPEECH_COMPONENT_ACCESS_DENIED'),(404,'SPEECH_COMPONENT_NOT_FOUND'),(429,'SPEECH_COMPONENT_ACCESS_UNAVAILABLE'),(500,'SPEECH_COMPONENT_ACCESS_UNAVAILABLE')]:
            error=Exception('private header secret');error.response=types.SimpleNamespace(status_code=status)
            self.assertEqual(access_error(error),expected)
        self.assertEqual(access_error(TimeoutError()),'SPEECH_COMPONENT_ACCESS_UNAVAILABLE')

    def test_access_missing_wrong_revision_or_size_cannot_certify_component(self):
        spec=self.spec();calls=[]
        with self.assertRaisesRegex(RuntimeError,'SPEECH_CODEC_AUTHORIZATION_REQUIRED'):
            verify_component_access(spec,None,metadata=lambda *a,**kw:calls.append(a))
        self.assertEqual(calls,[])
        for result in [types.SimpleNamespace(size=1,commit_hash=spec['revision']),types.SimpleNamespace(size=spec['size'],commit_hash='0'*40)]:
            with self.assertRaisesRegex(RuntimeError,'SPEECH_COMPONENT_NOT_FOUND'):
                verify_component_access(spec,'synthetic',metadata=lambda *a,**kw:result)
        with self.assertRaisesRegex(ValueError,'SPEECH_MANIFEST_MISMATCH'):
            verify_component_access({**spec,'sourcePath':'../secret'},'synthetic',metadata=lambda *a,**kw:calls.append(a))

    def test_incomplete_audar_does_not_affect_independent_habibi_runtime_choice(self):
        from speech.backends import load_backend
        self.assertEqual(manifest_for('habibi-irq')['modelId'],'habibi-irq')
        self.assertTrue(all(s.get('repoId')!='neuphonic/neucodec' and not s.get('gated') for s in manifest_for('habibi-irq')['files']))
        with self.assertRaisesRegex(RuntimeError,'SPEECH_WEIGHTS_NOT_READY'):
            verify_local_model(Path(__file__).parent/'definitely-no-model-weights','audar-tts-v1-flash')
        # Actual factory routing is covered with injected official API boundaries
        # in test_speech_runtime; no expression/profile is silently switched.
        with patch.dict(sys.modules,{'torch':types.SimpleNamespace()}),patch('speech.backends.HabibiBackend',return_value='habibi-sentinel') as habibi,patch('speech.backends.AudarBackend',side_effect=AssertionError('No Audar substitution')):
            self.assertEqual(load_backend('/synthetic','habibi-irq','cpu'),'habibi-sentinel');habibi.assert_called_once()


if __name__=='__main__':unittest.main()
