"""Synthetic CPU-only transfer evidence. No SDK, downloads, models or GPU."""
import ast
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch,Mock

ENGINE=Path(__file__).resolve().parents[1]/'engine'
sys.path.insert(0,str(ENGINE))
from transfer_identity import manifest_identity
from transfer_verified_copy import copy_with_destination_verification,TransferScopeChanged
from destination_integrity import verify_mounted_files
from transfer_orchestrator import advance
import transfer_contract as contract

class CopyProfiles(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.source=self.root/'source';self.dest=self.root/'dest'
        self.source.mkdir();self.dest.mkdir();self.uploads=[]
        self.data={f'component-{i}.bin':bytes([i+1])*37 for i in range(6)}
        self.manifest={'id':'synthetic-dfr-six','model_revision':'fixture','source_commit':'fixture','pipeline':'DFRPipeline','files':{name:{'size':len(data),'sha256':hashlib.sha256(data).hexdigest()} for name,data in self.data.items()}}
        for name,data in self.data.items():(self.source/name).write_bytes(data)
        outer=self
        class Target:
            def ensure(self):pass
            def upload(self,name,path):outer.uploads.append(name);(outer.dest/name).write_bytes(Path(path).read_bytes())
            def upload_bytes(self,name,content):assert name in ('READY.json','RUNTIME.json');(outer.dest/name).write_bytes(content)
            def read(self,name):
                if name!='READY.json':raise AssertionError('MODEL_BYTES_MUST_NOT_CROSS_CONTROL_PLANE')
                yield (outer.dest/name).read_bytes()
        self.target=Target()
    def verify(self,phase):
        return {**verify_mounted_files(self.dest,self.manifest['files']),**manifest_identity(self.manifest),'revision':'fixture'}
    def copy(self,approved,**kwargs):
        return copy_with_destination_verification(self.manifest,self.source,self.target,approved,self.verify,**kwargs)
    def test_dfr_six_copies_only_two_additions_and_writes_matching_ready_runtime(self):
        names=list(self.data)
        (self.dest/'retained-old-conv.bin').write_bytes(b'preserve historical component')
        for name in names[:4]:(self.dest/name).write_bytes(self.data[name])
        result=self.copy(names[4:]);self.assertTrue(result['ready']);self.assertFalse(result['gpuUsed']);self.assertEqual(self.uploads,names[4:]);self.assertEqual(result['transferredBytes'],74)
        marker=json.loads((self.dest/'READY.json').read_text());runtime=json.loads((self.dest/'RUNTIME.json').read_text())
        self.assertEqual(set(marker['files']),set(self.data));self.assertEqual(marker['profile'],'dfr-main');self.assertEqual(marker['manifestFingerprint'],manifest_identity(self.manifest)['manifestFingerprint']);self.assertEqual(runtime['vae'],'diffusion');self.assertEqual(runtime['gpu_choices'],['RTX-PRO-6000'])
        for name,data in self.data.items():self.assertEqual((self.source/name).read_bytes(),data)
        self.assertEqual((self.dest/'retained-old-conv.bin').read_bytes(),b'preserve historical component')
    def test_explicit_conv_five_preserves_its_profile_and_runtime(self):
        self.manifest['pipeline']='DistilledPipeline';self.manifest['id']='synthetic-conv-five';self.manifest['files'].pop(list(self.data)[-1])
        result=self.copy(list(self.manifest['files']));self.assertTrue(result['ready']);self.assertEqual(len(self.uploads),5)
        marker=json.loads((self.dest/'READY.json').read_text());runtime=json.loads((self.dest/'RUNTIME.json').read_text());self.assertEqual(marker['profile'],'conv-stable');self.assertEqual(len(marker['files']),5);self.assertEqual(runtime['vae'],'conv')
    def test_corrupt_completed_file_needs_new_approval_without_overwrite(self):
        names=list(self.data)
        for name,data in self.data.items():(self.dest/name).write_bytes(data)
        (self.dest/names[0]).write_bytes(b'x'*37)
        result=self.copy([]);self.assertTrue(result['requiresNewPlan']);self.assertEqual(self.uploads,[]);self.assertEqual((self.dest/names[0]).read_bytes(),b'x'*37);self.assertFalse((self.dest/'READY.json').exists())
        self.assertTrue(self.copy([names[0]])['ready']);self.assertEqual(self.uploads,[names[0]])
    def test_partial_upload_restarts_only_that_file_and_retains_all_completed_files(self):
        names=list(self.data)
        for name,data in self.data.items():(self.dest/name).write_bytes(data)
        (self.dest/names[2]).write_bytes(self.data[names[2]][:7])
        result=self.copy([names[2]]);self.assertTrue(result['ready']);self.assertEqual(self.uploads,[names[2]]);self.assertEqual(result['transferredBytes'],37)
    def test_source_missing_or_corrupt_never_fetches_or_writes_ready(self):
        names=list(self.data)
        for name in names[1:]:(self.dest/name).write_bytes(self.data[name])
        (self.source/names[0]).unlink()
        with self.assertRaises(FileNotFoundError):self.copy([names[0]])
        (self.source/names[0]).write_bytes(b'wrong')
        with self.assertRaisesRegex(ValueError,'SOURCE_SHA256_MISMATCH'):self.copy([names[0]])
        self.assertEqual(self.uploads,[]);self.assertFalse((self.dest/'READY.json').exists())
    def test_verify_only_and_worker_upload_do_not_claim_ready_or_write_marker(self):
        name=next(iter(self.data));(self.dest/name).write_bytes(self.data[name])
        result=self.copy([],verify_only=True);self.assertTrue(result['verificationOnly']);self.assertFalse(result['ready']);self.assertEqual(self.uploads,[])
        result=self.copy(list(self.data),upload_only=True);self.assertEqual(result['status'],'awaiting_verification');self.assertFalse(result['ready']);self.assertFalse((self.dest/'READY.json').exists())
    def test_receipt_from_another_profile_is_rejected_before_upload(self):
        def wrong(phase):return {**self.verify(phase),'manifestFingerprint':'other-profile'}
        with self.assertRaisesRegex(ValueError,'VERIFIER_RECEIPT_PROFILE_MISMATCH'):copy_with_destination_verification(self.manifest,self.source,self.target,list(self.data),wrong)
        self.assertEqual(self.uploads,[]);self.assertFalse((self.dest/'READY.json').exists())

class StaticContract(unittest.TestCase):
    def test_node_python_profile_manifest_and_worker_fingerprints_match(self):
        node=shutil.which('node');self.assertTrue(node)
        code="import {transferIdentity,workerFingerprint,bindTransferPlan} from './engine/transfer-profile.mjs';import {inferenceManifest} from './engine/config.mjs';const files=Object.entries(inferenceManifest.files).map(([name,f])=>({name,size:f.size,sha256:f.sha256}));console.log(JSON.stringify({...transferIdentity,workerFingerprint,plan:bindTransferPlan({files,mode:'full',sourceVolume:'modal-ltx25-test-models',destinationVolume:'iff-ltx25-1234abcd',requiredBytes:files.reduce((n,f)=>n+f.size,0),transport:'modal-cpu-cloud'})}));"
        for profile,count in [('dfr-main',6),('dfr-candidate',6),('conv-stable',5)]:
            env={**os.environ,'LTX_INFERENCE_PROFILE':profile}
            node_result=json.loads(subprocess.check_output([node,'--input-type=module','-e',code],cwd=ENGINE.parent,env=env,text=True))
            pycode="import json,transfer_contract as c;print(json.dumps({**c.IDENTITY,'workerFingerprint':c.FINGERPRINT,'count':len(c.MANIFEST['files'])}));"
            python_result=json.loads(subprocess.check_output([sys.executable,'-c',pycode],cwd=ENGINE,env=env,text=True));self.assertEqual(python_result.pop('count'),count)
            self.assertEqual({k:node_result[k] for k in python_result},python_result)
            validation="import sys,json,transfer_contract as c;p=json.load(sys.stdin);c.validate_plan(p,p['destinationVolume']);print('valid')"
            checked=subprocess.run([sys.executable,'-c',validation],cwd=ENGINE,env=env,input=json.dumps(node_result['plan']),capture_output=True,text=True,check=True);self.assertEqual(checked.stdout.strip(),'valid')
    def test_stale_plan_rejected_by_python_before_sdk_preflight(self):
        with self.assertRaisesRegex(ValueError,'TRANSFER_PROFILE_CHANGED_REQUOTE'):contract.validate_plan({'profile':'old'},'iff-ltx25-1234abcd')
        files=list(contract.MANIFEST['files']);scope=contract.plan_scope(files,'full','iff-ltx25-1234abcd')
        plan={**scope,'transferPlanFingerprint':contract.fingerprint(scope),'requiredBytes':sum(f['size'] for f in scope['files'])}
        self.assertEqual(set(contract.validate_plan(plan,'iff-ltx25-1234abcd')),set(files))
        plan['files'][0]['size']-=1
        with self.assertRaisesRegex(ValueError,'TRANSFER_PLAN_CHANGED_REQUOTE'):contract.validate_plan(plan,'iff-ltx25-1234abcd')
    def test_images_pin_profile_and_include_selected_manifest_inputs_without_job_payload(self):
        class Image:
            def __init__(self):self.environment={};self.files=[]
            def env(self,value):self.environment.update(value);return self
            def add_local_file(self,source,target):self.files.append(target);return self
        image=contract.add_profile_files(Image());self.assertEqual(image.environment,{'LTX_INFERENCE_PROFILE':contract.INFERENCE_PROFILE})
        for name in ('runtime/inference_profile.py','runtime/production-profile.json','runtime/conv-profile.json','transfer_identity.py'):self.assertIn('/root/'+name,image.files)
        for name in ('transfer_worker.py','destination_verifier_app.py'):
            tree=ast.parse((ENGINE/name).read_text(encoding='utf-8'));self.assertTrue(any(isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='add_profile_files' for n in ast.walk(tree)))
    def test_worker_request_and_host_dispatch_reject_stale_profile_before_sdk_call(self):
        names=list(contract.MANIFEST['files']);scope=contract.plan_scope(names,'full','iff-ltx25-1234abcd')
        request={**contract.IDENTITY,'fingerprint':contract.FINGERPRINT,'mode':'full','volume':scope['destinationVolume'],'files':names,'transferPlanFingerprint':contract.fingerprint(scope)}
        self.assertTrue(contract.validate_request(request))
        with self.assertRaisesRegex(ValueError,'TRANSFER_PROFILE_CHANGED_REQUOTE'):contract.validate_request({**request,'profile':'wrong'})
        # Load the actual controller against an empty fake SDK. A stale plan must
        # reject before preflight, client creation, Dict writes or worker spawn.
        spec=importlib.util.spec_from_file_location('isolated_transfer_host',ENGINE/'cloud_transfer_host.py');module=importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules,{'modal':types.SimpleNamespace()}):
            spec.loader.exec_module(module)
            with patch.object(module,'preflight',side_effect=AssertionError('SDK_PREFLIGHT_FORBIDDEN')) as preflight:
                with self.assertRaisesRegex(ValueError,'TRANSFER_PROFILE_CHANGED_REQUOTE'):module.dispatch({'paidApproved':True,'plan':{'profile':'stale'},'volume':scope['destinationVolume']})
                preflight.assert_not_called()
    def test_lost_cpu_dispatch_is_never_retried_or_declared_stopped(self):
        class State:
            def __init__(self):self.data={}
            def get(self,key,default=None):return self.data.get(key,default)
            def put(self,key,value,skip_if_exists=False):
                if skip_if_exists and key in self.data:return False
                self.data[key]=value;return True
            def pop(self,key,default=None):return self.data.pop(key,default)
        class Adapter:
            calls=0
            def submit(self,stage):self.calls+=1;raise ConnectionError('synthetic lost acknowledgement')
            def counts(self):return (0,0)
        state=State();adapter=Adapter();state.put('active','fixture');record={'mode':'full'}
        first=advance(state,'fixture',record,adapter);second=advance(state,'fixture',record,adapter)
        self.assertEqual(adapter.calls,1);self.assertFalse(first['cloud_stopped']);self.assertFalse(second['cloud_stopped']);self.assertEqual(state.get('active'),'fixture')
    def test_known_unapproved_corruption_never_submits_source_or_claims_ambiguity(self):
        class State:
            def __init__(self):self.data={}
            def get(self,key,default=None):return self.data.get(key,default)
            def put(self,key,value,skip_if_exists=False):
                if skip_if_exists and key in self.data:return False
                self.data[key]=value;return True
            def pop(self,key,default=None):return self.data.pop(key,default)
        class Adapter:
            calls=0
            def submit(self,stage):self.calls+=1;raise TransferScopeChanged(['unapproved-corrupt.bin'])
            def observe(self,*args,**kwargs):return {'terminal':True,'result':{}}
            def counts(self):return (0,0)
        state=State();adapter=Adapter();state.put('active','fixture');state.put('orchestrator:fixture:before',{'callId':'local-fixture-completed','reservedAt':0})
        first=advance(state,'fixture',{'mode':'full'},adapter);second=advance(state,'fixture',{'mode':'full'},adapter)
        self.assertTrue(first['cloud_stopped']);self.assertTrue(second['cloud_stopped']);self.assertTrue(first['result']['requiresNewPlan']);self.assertEqual(first['result']['status'],'needs_review');self.assertEqual(adapter.calls,1);self.assertEqual(first['result']['corruptFiles'],['unapproved-corrupt.bin'])

if __name__=='__main__':unittest.main()
