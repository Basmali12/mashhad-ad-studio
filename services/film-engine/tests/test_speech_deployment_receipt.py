"""Run the complete deployment receipt branch with an inert SDK, never cloud."""
import hashlib
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'engine'))
from speech import deploy

class ReceiptTests(unittest.TestCase):
    def test_each_habibi_deployment_persists_its_actual_manifest_revision(self):
        for model_id in ('habibi-irq','habibi-egy','habibi-msa'):
            with self.subTest(model_id=model_id):
                class Missing(Exception):pass
                volumes={}
                class Volume:
                    def __init__(self):self.files={}
                    def hydrate(self):return self
                    def read_file(self,name):return iter([self.files[name]])
                    def batch_upload(self,**kwargs):return self
                    def __enter__(self):return self
                    def __exit__(self,*args):pass
                    def put_file(self,stream,name):self.files[name]=stream.read()
                def volume(name,**kwargs):
                    if name not in volumes:
                        if not kwargs.get('create_if_missing'):raise Missing()
                        volumes[name]=Volume()
                    return volumes[name]
                def lookup(*args,**kwargs):raise Missing()
                remote=types.SimpleNamespace(object_id='cs-scoped',hydrate=lambda:None)
                app=types.SimpleNamespace(app_id='ap-scoped',deploy=lambda **kwargs:None)
                sdk=types.SimpleNamespace(exception=types.SimpleNamespace(NotFoundError=Missing),App=types.SimpleNamespace(lookup=lookup),Volume=types.SimpleNamespace(from_name=volume),Cls=types.SimpleNamespace(from_name=lambda *args,**kwargs:remote))
                engine='12345678-1234-1234-1234-123456789abc'
                manifest=deploy.manifest_for(model_id)
                definition=dict(id=engine,accountId='account-one',modelId=model_id,volume='model-weights',weightPath=f'models/{model_id}/{engine}',gpu='L40S',cpu=2,ramGiB=16)
                packet=dict(definition=definition,paidApproved=True,modelRevision=manifest['revision'],manifestFingerprint=deploy.manifest_fingerprint(model_id),scope=dict(engineId=engine,accountId='account-one',runId='run-one',requestId='request-one'))
                with patch.object(deploy,'build_speech_app',return_value=(app,remote)):
                    result=deploy.deploy_speech_app(packet,client=object(),sdk=sdk)
                name='mashhad-speech-'+model_id+'-results-'+hashlib.sha256(engine.encode()).hexdigest()[:16]
                saved=json.loads(volumes[name].files['deployment.json'])
                self.assertEqual(saved['modelRevision'],manifest['revision'])
                self.assertEqual(saved['modelId'],model_id)
                self.assertEqual(saved['classId'],'cs-scoped')
                self.assertFalse(saved['gpuStarted'])
                self.assertTrue(result['deploymentReady'])

if __name__=='__main__':unittest.main()
