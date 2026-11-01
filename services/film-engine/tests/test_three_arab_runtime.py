"""Local fake backend only: no torch, Modal, weights, inference or network."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'engine'))
from three_arab import runtime
from three_arab import build_lock
from three_arab.watermark import validate_detection,checked_checkpoint,headroom_gain

class CandidateTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name);self.model=self.root/'assets';self.model.mkdir();(self.model/'fixture').write_bytes(b'mock')
  real=runtime.manifest();self.spec={**real,'files':[{'path':'fixture','size':4,'sha256':runtime.digest(b'mock')}]};self.patcher=patch.object(runtime,'manifest',return_value=self.spec);self.patcher.start();self.addCleanup(self.patcher.stop);self.calls=[]
  owner=self
  class Backend:
   def synthesize(self,request,target):owner.calls.append(request);target.write_bytes(b'not-actual-audio');return {'file':str(target),'sampleRate':48000,'usedSeed':request['seed']}
  self.engine=runtime.ThreeArabRuntime(self.model,backend_factory=lambda root:Backend())
  self.request={'text':'في ليلة ساد فيها السكون، جلس رجل يتأمل حياته.','style':'solemn','seed':42,'seconds':15}
 def test_native_loading_cannot_bypass_unresolved_rights_with_a_caller_boolean(self):
  from three_arab.native import NativeBackend
  with patch.object(runtime,'manifest',return_value={**self.spec,'usageEligibility':{'internalTesting':'unresolved'}}):
   with self.assertRaisesRegex(RuntimeError,'WATERMARK_LICENSE_UNRESOLVED'):NativeBackend(self.model)
  self.assertFalse(self.calls)
 def test_audioseal_receipt_requires_detection_and_exact_version_payload(self):
  bits=[(0x4D53>>i)&1 for i in range(15,-1,-1)]
  self.assertTrue(validate_detection(.99,bits)['detected'])
  for score,decoded in [(.3,bits),(float('nan'),bits),(.99,[0]*16)]:
   with self.assertRaisesRegex(RuntimeError,'DETECTION_FAILED'):validate_detection(score,decoded)
 def test_audioseal_missing_checkpoint_never_falls_back_to_network(self):
  with patch('three_arab.watermark.manifest',return_value={'files':[{'path':'audioseal/generator_base.pth','size':10,'sha256':'0'*64}]}):
   with self.assertRaisesRegex(RuntimeError,'CHECKPOINT_NOT_READY'):checked_checkpoint(self.model,'generator_base.pth')
 def test_active_variant_uses_only_permissively_licensed_watermark_assets(self):
  self.assertEqual(self.spec['watermarkBackend'],'audioseal')
  real=json.loads((Path(runtime.__file__).parent/'manifest.json').read_text(encoding='utf-8'))
  self.assertEqual(len([f for f in real['files'] if f['repoId']=='facebook/audioseal']),2)
  self.assertFalse(any(f['repoId']=='sony/silentcipher' for f in real['files']))
 def test_workspace_label_fix_preserves_every_dependency_byte(self):
  data=b'[[package]]\nname = "irodori-tts"\nversion = "0.1.0"\n'
  with patch.object(build_lock,'EXPECTED',hashlib.sha256(data).hexdigest()):
   fixed=build_lock.repair(data)
   self.assertEqual(fixed.replace(build_lock.NEW,build_lock.OLD),data)
  with self.assertRaisesRegex(RuntimeError,'UPSTREAM_LOCK_CHANGED'):build_lock.repair(data+b'changed')
 def test_provider_mount_is_canonicalized_but_trial_child_is_closed(self):
  from three_arab.modal_trial import trial_directory
  target=trial_directory('assets',self.root)
  self.assertEqual(target,self.root.resolve()/'private-three-arab-audioseal-v1/assets')
  with self.assertRaisesRegex(ValueError,'TRIAL_PATH_INVALID'):trial_directory('../outside',self.root)
 def test_native_environment_is_not_injected_into_modal_interpreter(self):
  from three_arab.modal_trial import build_image,native_command
  from types import SimpleNamespace
  environments=[]
  class Image:
   def apt_install(self,*a,**kw):return self
   def pip_install(self,*a,**kw):return self
   def add_local_file(self,*a,**kw):return self
   def run_commands(self,*a,**kw):return self
   def add_local_dir(self,*a,**kw):return self
   def env(self,value):environments.append(value);return self
  sdk=SimpleNamespace(Image=SimpleNamespace(debian_slim=lambda **kw:Image()))
  build_image(sdk)
  self.assertEqual(environments[0]['PYTHONPATH'],'/root')
  with patch('subprocess.run',return_value=SimpleNamespace(stdout='',stderr='',returncode=0)) as run:
   native_command('inspect',self.model,timeout=90)
  args,kw=run.call_args
  self.assertEqual(args[0][0],'/opt/three-arab/.venv/bin/python')
  self.assertEqual(kw['timeout'],90)
  self.assertNotIn('shell',kw)
 def test_headroom_does_not_clip_or_require_time_or_pitch_changes(self):
  for peak in (.5,.98,1.,1.03):
   gain=headroom_gain(peak);self.assertLessEqual(peak*gain,.98000001);self.assertGreaterEqual(gain,.8)
  self.assertEqual(headroom_gain(.5),1.)
  with self.assertRaisesRegex(RuntimeError,'EXCESSIVE_HEADROOM'):headroom_gain(2.)
 def test_two_captions_are_not_habibi_emotion_tokens(self):
  for style in ('solemn','calm'):
   value=runtime.validate_request({**self.request,'style':style});self.assertTrue(value['noReference']);self.assertFalse(value['trimTail']);self.assertEqual(value['numSteps'],40);self.assertIn('رجل',value['caption'])
 def test_missing_or_invalid_explicit_duration_blocks_thirty_second_fallback(self):
  for duration in (None,True,0,30,float('nan')):
   with self.assertRaisesRegex(ValueError,'DURATION'):runtime.validate_request({**self.request,'seconds':duration})
 def test_empty_oversized_and_injected_fields_rejected_before_backend(self):
  for patching in ({'text':''},{'text':'a'*601},{'text':'<|token|>'},{'style':'unknown'},{'seed':True},{'url':'https://bad.test'}):
   with self.assertRaises(ValueError):runtime.validate_request({**self.request,**patching})
  self.assertFalse(self.calls)
 def test_approval_and_rights_are_separate_no_model_load(self):
  for flags in ({},{'approved':True},{'rights_reviewed':True}):
   with self.assertRaisesRegex(RuntimeError,'APPROVAL'):self.engine.generate(self.request,self.root/'output',execution_id='one',**flags)
  self.assertFalse(self.calls)
 def test_missing_or_changed_weights_fail_before_native_load(self):
  (self.model/'fixture').write_bytes(b'bad!')
  with self.assertRaisesRegex(RuntimeError,'ASSET_CHANGED'):self.engine.generate(self.request,self.root/'out',approved=True,rights_reviewed=True,execution_id='one')
  self.assertFalse(self.calls)
 def test_successful_call_is_never_repeated(self):
  result=self.engine.generate(self.request,self.root/'out',approved=True,rights_reviewed=True,execution_id='one');self.assertFalse(result['listeningApproved']);self.assertFalse(result['sameAsDemoGuaranteed'])
  with self.assertRaises(FileExistsError):self.engine.generate(self.request,self.root/'out',approved=True,rights_reviewed=True,execution_id='one')
  self.assertEqual(len(self.calls),1)
 def test_failure_is_uncertain_and_cannot_silently_repeat(self):
  self.engine.backend=type('Broken',(),{'synthesize':lambda *args:(_ for _ in ()).throw(RuntimeError('fixture failure'))})()
  with self.assertRaisesRegex(RuntimeError,'fixture failure'):self.engine.generate(self.request,self.root/'out',approved=True,rights_reviewed=True,execution_id='one')
  with self.assertRaises(FileExistsError):self.engine.generate(self.request,self.root/'out',approved=True,rights_reviewed=True,execution_id='one')
 def test_escaping_manifest_path_does_not_admit_a_weight(self):
  with self.assertRaisesRegex(RuntimeError,'NOT_READY'):runtime.verify_files(self.model,{'files':[{'path':'../escape','size':4,'sha256':runtime.digest(b'mock')}]})

if __name__=='__main__':unittest.main()
