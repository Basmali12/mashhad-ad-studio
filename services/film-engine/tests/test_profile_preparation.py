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
        self.manifest={'id':'synthetic-model-six','model_revision':'fixture','source_commit':'fixture','runtime':{'format':'fixture'},'files':{name:{'size':len(data),'sha256':hashlib.sha256(data).hexdigest()} for name,data in self.data.items()}}
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
    def test_model_copies_only_two_additions_and_writes_matching_ready_runtime(self):
        names=list(self.data)
        (self.dest/'unrelated-model.bin').write_bytes(b'preserve unrelated component')
        for name in names[:4]:(self.dest/name).write_bytes(self.data[name])
        result=self.copy(names[4:]);self.assertTrue(result['ready']);self.assertFalse(result['gpuUsed']);self.assertEqual(self.uploads,names[4:]);self.assertEqual(result['transferredBytes'],74)
        marker=json.loads((self.dest/'READY.json').read_text());runtime=json.loads((self.dest/'RUNTIME.json').read_text())
        self.assertEqual(set(marker['files']),set(self.data));self.assertEqual(marker['profile'],'synthetic-model-six');self.assertEqual(marker['manifestFingerprint'],manifest_identity(self.manifest)['manifestFingerprint']);self.assertEqual(runtime['runtime'],{'format':'fixture'});self.assertFalse(runtime['generationValidated'])
        for name,data in self.data.items():self.assertEqual((self.source/name).read_bytes(),data)
        self.assertEqual((self.dest/'unrelated-model.bin').read_bytes(),b'preserve unrelated component')
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
