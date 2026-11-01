"""Model retirement is offline: no SDK calls, images, downloads or GPU."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import types
import unittest
from unittest.mock import patch

ENGINE=Path(__file__).resolve().parents[1]/'engine'
sys.path.insert(0,str(ENGINE))
import modal_bridge
import model_profile
import transfer_contract


class RetiredModelTests(unittest.TestCase):
    def test_retired_inference_and_model_manifests_are_absent(self):
        self.assertFalse((ENGINE/'runtime').exists())
        self.assertFalse((ENGINE/'gpu_host.py').exists())
        self.assertFalse(model_profile.MANIFEST['enabled'])
        self.assertEqual(model_profile.MANIFEST['files'],{})

    def test_generation_and_session_reject_before_authentication_or_provider(self):
        with patch.object(modal_bridge,'client',side_effect=AssertionError('PROVIDER_FORBIDDEN')) as client:
            for action in ('generate','session'):
                with self.assertRaisesRegex(RuntimeError,'ENGINE_NOT_CONFIGURED'):
                    modal_bridge.execute({'action':action,'paidApproved':True})
            client.assert_not_called()

    def test_jsonlines_generation_emits_specific_safe_failure(self):
        result=subprocess.run([sys.executable,str(ENGINE/'modal_bridge.py')],
                              input='{"action":"generate","paidApproved":true}\n',
                              capture_output=True,text=True)
        self.assertEqual(result.returncode,1)
        self.assertEqual(json.loads(result.stdout),{'type':'error','data':{'code':'ENGINE_NOT_CONFIGURED'}})

    def test_credential_verification_remains_available_without_model(self):
        with patch.object(modal_bridge,'client',return_value=(object(),'workspace')):
            result=modal_bridge.execute({'action':'verify','credentials':{}})
        self.assertEqual(result,{'workspace':'workspace','verified':True,'capacity':'unknown'})

    def test_scoped_resource_inspection_and_stop_remain_available(self):
        for action in ('inspect','stop'):
            with patch.object(modal_bridge,'client'),patch.object(modal_bridge,'sync_metadata',return_value={'cloud_stopped':True}) as meta:
                result=modal_bridge.execute({'action':action,'credentials':{},'appId':'app','jobId':'job'})
                self.assertTrue(result['cloud_stopped'])
                self.assertEqual(meta.call_args.args[3],action=='stop')

    def test_discovery_lists_account_without_reading_a_model_volume(self):
        fake_modal=types.SimpleNamespace(__version__='1.6.2')
        with patch.dict(sys.modules,{'modal':fake_modal}),patch.object(modal_bridge,'client',return_value=(object(),'workspace')),patch.object(modal_bridge,'sync_metadata',return_value={'apps':[],'volumes':[]}):
            result=modal_bridge.discover({'credentials':{},'volume':'unrelated'})
        self.assertFalse(result['ready'])
        self.assertFalse(result['modelConfigured'])
        self.assertEqual(result['files'],[])
        self.assertEqual(result['reason'],'ENGINE_NOT_CONFIGURED')

    def test_unconfigured_transfer_and_official_plan_never_import_downloads(self):
        for action in ('transfer','official_plan'):
            with self.assertRaisesRegex(RuntimeError,'ENGINE_NOT_CONFIGURED'):
                modal_bridge.execute({'action':action,'paidApproved':True})

    def test_stale_transfer_plan_and_request_reject_when_model_removed(self):
        with self.assertRaisesRegex(RuntimeError,'ENGINE_NOT_CONFIGURED'):
            transfer_contract.validate_plan({'profile':'retired'},'mashhad-model-1234abcd')
        with self.assertRaisesRegex(RuntimeError,'ENGINE_NOT_CONFIGURED'):
            transfer_contract.validate_request({'paidApproved':True})

    def test_transfer_image_definition_refuses_unconfigured_model(self):
        with self.assertRaisesRegex(RuntimeError,'ENGINE_NOT_CONFIGURED'):
            transfer_contract.add_profile_files(object())

    def test_transfer_preflight_is_local_when_unconfigured(self):
        spec=importlib.util.spec_from_file_location('offline_transfer_controller',ENGINE/'cloud_transfer_host.py')
        module=importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules,{'modal':types.SimpleNamespace()}):
            spec.loader.exec_module(module)
            with patch.object(module,'control',side_effect=AssertionError('RPC_FORBIDDEN')):
                result=module.preflight({})
            self.assertFalse(result['workerReady'])
            self.assertEqual(result['reason'],'ENGINE_NOT_CONFIGURED')

    def test_generic_profile_rejects_path_escape_and_bad_hash(self):
        fixture={'id':'fixture','enabled':True,'storage_prefix':'/models/fixture','model_revision':'revision',
                 'files':{'part.bin':{'size':10,'sha256':'a'*64}}}
        with patch.object(model_profile,'MANIFEST',fixture):
            self.assertEqual(model_profile.require_model(),fixture)
            fixture['files']={'../escape.bin':{'size':10,'sha256':'a'*64}}
            with self.assertRaisesRegex(RuntimeError,'INVALID_MODEL_FILE'):model_profile.require_model()
            fixture['files']={'part.bin':{'size':10,'sha256':'bad'}}
            with self.assertRaisesRegex(RuntimeError,'INVALID_MODEL_FILE'):model_profile.require_model()


if __name__=='__main__':unittest.main()
