import copy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import uuid

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'engine'))
from weight_batch import model_profile, validate_plan, run_batch, build_cpu_app


def plan_for(ids):
    plan={'approved':True,'workspace':'basm1998ali','accountId':str(uuid.uuid4()),'appName':'mashhad-weights-abcdef123456',
          'modelVolume':'mashhad-models-abcdef123456','resultsVolume':'mashhad-preparations-abcdef123456',
          'hunyuanLicenseAccepted':True,'audarLicenseAccepted':True,'codecLicenseAccepted':True,'models':[]}
    for model_id in ids:
        manifest,fingerprint=model_profile(model_id)
        plan['models'].append({'modelId':model_id,'engineId':str(uuid.uuid4()),'revision':manifest['revision'],'manifestFingerprint':fingerprint})
    return plan


class Tests(unittest.TestCase):
    def test_hunyuan_connection_failure_requires_separate_explicit_recovery_and_keeps_existing_engine_ids(self):
        script=Path(__file__).resolve().parents[3]/'scripts/prepare-mashhad-weights.py'
        spec=importlib.util.spec_from_file_location('weight_recovery_controller_test',script);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory).resolve();repo=base/'x/repo';repo.mkdir(parents=True)
            previous=base/'work/mashhad-weights-primary-20261031-attempt2';previous.mkdir(parents=True)
            plan=plan_for(['habibi-irq','hunyuanvideo15','audar-tts-v1-flash'])
            (previous/'plan.json').write_text(json.dumps(plan))
            (previous/'latest-result.json').write_text(json.dumps({'status':'failed','results':[{'modelId':'habibi-irq','status':'completed'},{'modelId':'hunyuanvideo15','status':'failed'}]}))
            (previous/'watchdog-state.json').write_text(json.dumps({'stopReason':'TRIAL_PROVIDER_STATE_UNKNOWN','cloudStopped':True,'deadline':20,'stoppedAt':10}))
            (previous/'batch.log').write_text('{"error":"WEIGHTS_CONTROLLER_FAILED","safeErrorType":"ConnectionError"}\n')
            with patch.object(module,'ROOT',repo),patch.object(module,'FOLDER',base/'denied'),patch.object(module,'ATTEMPT',3),patch.object(module,'RECOVERY',False):
                with self.assertRaisesRegex(ValueError,'WEIGHTS_NOT_A_TIME_CONTINUATION'):module.initialize()
            destination=base/'recovery'
            with patch.object(module,'ROOT',repo),patch.object(module,'FOLDER',destination),patch.object(module,'ATTEMPT',3),patch.object(module,'RECOVERY',True):module.initialize()
            recovered=json.loads((destination/'plan.json').read_text())
            self.assertEqual([row['modelId'] for row in recovered['models']],['hunyuanvideo15','audar-tts-v1-flash'])
            self.assertEqual(recovered['models'][0]['engineId'],plan['models'][1]['engineId'])
            self.assertEqual(recovered['modelVolume'],plan['modelVolume'])

    def test_continuation_initialization_skips_completed_models_reuses_storage_and_requires_time_stop(self):
        script=Path(__file__).resolve().parents[3]/'scripts/prepare-mashhad-weights.py'
        spec=importlib.util.spec_from_file_location('weight_resume_controller_test',script);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory).resolve();repo=base/'x/repo';repo.mkdir(parents=True)
            previous=base/'work/mashhad-weights-primary-20261031-attempt2';previous.mkdir(parents=True)
            destination=base/'work/mashhad-weights-primary-20261031-attempt3'
            plan=plan_for(['habibi-irq','qwen-image-edit-2511'])
            (previous/'plan.json').write_text(json.dumps(plan))
            (previous/'latest-result.json').write_text(json.dumps({'status':'running','results':[{'modelId':'habibi-irq','status':'completed'},{'modelId':'qwen-image-edit-2511','status':'running'}]}))
            watcher={'stopReason':'TRIAL_MAIN_FINISHED','cloudStopped':True,'deadline':10,'stoppedAt':11}
            (previous/'watchdog-state.json').write_text(json.dumps(watcher))
            (previous/'batch.log').write_text('{"error":"WEIGHTS_BUDGET_GUARD_CLOSED"}\n')
            with patch.object(module,'ROOT',repo),patch.object(module,'FOLDER',destination),patch.object(module,'ATTEMPT',3):
                module.initialize()
            resumed=json.loads((destination/'plan.json').read_text())
            self.assertEqual([r['modelId'] for r in resumed['models']],['qwen-image-edit-2511'])
            self.assertEqual(resumed['models'][0]['engineId'],plan['models'][1]['engineId'])
            self.assertEqual(resumed['modelVolume'],plan['modelVolume']);self.assertEqual(resumed['accountId'],plan['accountId'])
            self.assertTrue(resumed['resume']);self.assertNotEqual(resumed['receiptPath'],'batch.json')
            watcher['stopReason']='TRIAL_PROVIDER_STATE_UNKNOWN';(previous/'watchdog-state.json').write_text(json.dumps(watcher))
            with patch.object(module,'ROOT',repo),patch.object(module,'FOLDER',base/'rejected'),patch.object(module,'ATTEMPT',3):
                with self.assertRaisesRegex(ValueError,'WEIGHTS_NOT_A_TIME_CONTINUATION'):module.initialize()

    def test_controller_waits_for_first_receipt_but_preserves_network_and_corruption_errors(self):
        script=Path(__file__).resolve().parents[3]/'scripts/prepare-mashhad-weights.py'
        spec=importlib.util.spec_from_file_location('weight_controller_test',script);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        def missing(name):raise FileNotFoundError('normal initial absence')
        self.assertIsNone(module.read_receipt(SimpleNamespace(read_file=missing)))
        self.assertEqual(module.read_receipt(SimpleNamespace(read_file=lambda name:iter([b'{"status":"running"}']))),{'status':'running'})
        def network(name):raise ConnectionError('private headers')
        with patch.object(module.time,'sleep'),self.assertRaises(ConnectionError):module.read_receipt(SimpleNamespace(read_file=network))
        from modal.exception import ConnectionError as ModalConnectionError
        with patch.object(module.time,'sleep'):
            calls=[]
            def transient(name):
                calls.append(name)
                if len(calls)==1:raise ModalConnectionError('private request headers')
                return [b'{"status":"running"}']
            self.assertEqual(module.read_receipt(SimpleNamespace(read_file=transient)),{'status':'running'})
            self.assertEqual(len(calls),2)
        with self.assertRaises(json.JSONDecodeError):module.read_receipt(SimpleNamespace(read_file=lambda name:iter([b'incomplete'])))

    def test_exact_pins_approval_and_no_flux_redownload(self):
        p=plan_for(['qwen-image-edit-2511']);validate_plan(p)
        for change in ({'approved':False},{'workspace':'another'},{'modelVolume':'unrelated'}):
            with self.assertRaises(ValueError):validate_plan({**p,**change})
        for field,value in (('modelId','flux2-klein-4b'),('revision','changed'),('manifestFingerprint','changed')):
            bad=copy.deepcopy(p);bad['models'][0][field]=value
            with self.assertRaises(ValueError):validate_plan(bad)

    def test_license_not_inferred_from_download_request(self):
        for model_id,field in (('hunyuanvideo15','hunyuanLicenseAccepted'),('audar-tts-v1-flash','codecLicenseAccepted')):
            p=plan_for([model_id]);p[field]=False
            with self.assertRaisesRegex(ValueError,'WEIGHTS_LICENSE_REQUIRED'):validate_plan(p)

    def run_local(self,plan,preparers,**kwargs):
        temporary=tempfile.TemporaryDirectory();self.addCleanup(temporary.cleanup)
        root=Path(temporary.name).resolve();models=root/'models';results=root/'results';models.mkdir();results.mkdir()
        return run_batch(plan,model_root=models,result_root=results,preparers=preparers,**kwargs),models,results

    def test_reuses_preparers_preserves_scopes_and_refuses_duplicate_batch(self):
        p=plan_for(['habibi-irq','qwen-image-edit-2511']);calls=[]
        def prepare(request,**kwargs):
            calls.append((request,kwargs));return {'status':'completed','ready':True}
        result,models,output=self.run_local(p,{r['modelId']:prepare for r in p['models']})
        self.assertEqual(result['status'],'completed');self.assertFalse(result['gpuUsed']);self.assertFalse(result['inferenceVerified'])
        self.assertEqual([r['modelId'] for r in result['results']],['habibi-irq','qwen-image-edit-2511'])
        for (request,args),row in zip(calls,p['models']):
            self.assertEqual(request['scope']['engineId'],row['engineId']);self.assertEqual(args['account_id'],p['accountId'])
            self.assertTrue(args['model_dir'].is_relative_to(models))
        with self.assertRaisesRegex(ValueError,'WEIGHTS_BATCH_ALREADY_DISPATCHED'):
            run_batch(p,model_root=models,result_root=output)

    def test_failure_stops_batch_without_retry_or_next_model(self):
        p=plan_for(['habibi-irq','habibi-egy']);calls=[]
        def fail(*args,**kwargs):calls.append(1);raise ValueError('private provider detail')
        with self.assertRaisesRegex(RuntimeError,'WEIGHTS_PREPARATION_FAILED'):
            self.run_local(p,{'habibi-irq':fail,'habibi-egy':fail})
        self.assertEqual(calls,[1])

    def test_explicit_resume_keeps_identity_and_old_receipt_and_uses_distinct_paid_operation(self):
        p=plan_for(['habibi-irq']);calls=[]
        def prepare(request,**kwargs):calls.append(request);return {'status':'completed','ready':True}
        _,models,output=self.run_local(p,{'habibi-irq':prepare})
        original=(output/'batch.json').read_bytes()
        resumed={**p,'appName':'mashhad-weights-123456abcdef','storageId':'abcdef123456','receiptPath':'batch-123456abcdef.json','resume':True}
        result=run_batch(resumed,model_root=models,result_root=output,preparers={'habibi-irq':prepare})
        self.assertEqual(result['results'][0]['engineId'],p['models'][0]['engineId'])
        self.assertEqual(calls[0]['scope']['engineId'],calls[1]['scope']['engineId'])
        self.assertNotEqual(calls[0]['scope']['runId'],calls[1]['scope']['runId'])
        self.assertEqual((output/'batch.json').read_bytes(),original)
        self.assertTrue((output/'batch-123456abcdef.json').exists())

    def test_gated_access_blocks_before_any_audar_weight_download(self):
        p=plan_for(['audar-tts-v1-flash']);calls=[]
        def denied(spec):raise RuntimeError('SPEECH_CODEC_AUTHORIZATION_REQUIRED')
        result,_,output=self.run_local(p,{'audar-tts-v1-flash':lambda *a,**kw:calls.append(1)},access_check=denied)
        self.assertFalse(calls);self.assertEqual(result['status'],'completed_with_blockers')
        self.assertEqual(result['results'][0]['error'],'SPEECH_CODEC_AUTHORIZATION_REQUIRED')
        self.assertNotIn('private',json.dumps(result));self.assertFalse((output/'models').exists())

    def test_factory_has_no_gpu_no_warm_workers_no_paid_retry(self):
        options=[];created=[]
        class Image:
            def pip_install_from_requirements(self,*args):return self
            def add_local_dir(self,*args,**kw):return self
            def add_local_file(self,*args,**kw):return self
        class App:
            def __init__(self,name):self.name=name
            def function(self,**kwargs):options.append(kwargs);return lambda fn:fn
        def volume(name,**kwargs):created.append(kwargs);return name
        sdk=SimpleNamespace(Image=SimpleNamespace(debian_slim=lambda **kw:Image()),App=App,Volume=SimpleNamespace(from_name=volume))
        build_cpu_app(plan_for(['habibi-irq']),sdk)
        self.assertEqual(len(options),1);self.assertNotIn('gpu',options[0]);self.assertEqual(options[0]['retries'],0)
        self.assertEqual(options[0]['min_containers'],0);self.assertEqual(options[0]['max_containers'],1)
        self.assertTrue(all(v['create_if_missing'] is False for v in created))


if __name__=='__main__':unittest.main()
