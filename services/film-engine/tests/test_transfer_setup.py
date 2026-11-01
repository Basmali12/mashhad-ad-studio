"""Offline recovery tests: real installed SDK imports, all RPC boundaries mocked."""
import copy
import json
import pathlib
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]/'engine'))
import host_account_transfer as host
from transfer_setup import checkpoint


class State:
    def __init__(self):
        self.data = {'deployment':{'appId':'ap-source'}}

    def get(self, key, default=None):
        return copy.deepcopy(self.data.get(key, default))

    def put(self, key, value, skip_if_exists=False):
        if skip_if_exists and key in self.data:
            return False
        self.data[key] = copy.deepcopy(value)
        return True


class TransferSetupTests(unittest.TestCase):
    def test_verified_unstarted_closure_is_terminal_and_never_redeploys(self):
        state = State()
        record = {'workspace':'destination','fingerprint':host.FINGERPRINT,'setup':{'errorClass':'VersionError'}}
        request = {'jobId':'job','credentials':{},'volume':'mashhad-model-1234abcd'}
        state.put('operator-closure:job',{'jobId':'job','noModelCallsStarted':True,'error':'TRANSFER_IMAGE_BUILDER_INCOMPATIBLE'})
        with patch.object(host,'require_external_control'), patch('modal_bridge.client',return_value=(object(),'destination')), \
             patch('destination_verifier_control.lookup_destination_verifier') as lookup, patch.object(host,'advance') as advance:
            result=host.status(request,record,object(),state)
            self.assertTrue(result['cloud_stopped'])
            self.assertEqual(result['result']['status'],'failed')
            lookup.assert_not_called();advance.assert_not_called()

    def test_safe_checkpoint_does_not_record_exception_text_or_custom_class(self):
        state, record = State(), {}
        secret_error = type('as_PRIVATE_SECRET', (Exception,), {})('ak_PRIVATE_SECRET credentials and traceback')
        checkpoint(state, 'dispatch:job', record, 'destination_deploy', secret_error)
        saved = json.dumps(state.data)
        self.assertNotIn('PRIVATE_SECRET', saved)
        self.assertEqual(record['setup']['errorClass'], 'UnknownError')
        self.assertEqual(record['setup']['phase'], 'destination_deploy')

    def test_destination_failure_saves_exact_phase_before_any_model_call(self):
        state = State()
        request = {'paidApproved':True,'jobId':'job','volume':'mashhad-model-1234abcd',
                   'plan':{'transferPlanFingerprint':'bound','mode':'full','files':[]}}
        def fail(*args, progress, **kwargs):
            progress('destination_registry')
            raise PermissionError('as_PRIVATE_SECRET')
        with patch.object(host, 'require_external_control'), patch.object(host, 'validate_plan'), \
             patch('destination_verifier_control.ensure_destination_verifier', side_effect=fail), \
             patch.object(host, 'advance') as advance:
            with self.assertRaises(PermissionError):
                host.dispatch(request, object(), state, object(), 'destination')
            advance.assert_not_called()
        saved = state.get('dispatch:job')
        self.assertEqual(saved['setup']['phase'], 'destination_registry')
        self.assertEqual(saved['setup']['errorClass'], 'PermissionError')
        self.assertNotIn('PRIVATE_SECRET', json.dumps(state.data))

    def test_existing_verified_deployment_reattaches_without_redeploy(self):
        state = State()
        record = {'workspace':'destination','fingerprint':host.FINGERPRINT}
        request = {'jobId':'job','credentials':{},'volume':'mashhad-model-1234abcd'}
        with patch.object(host, 'require_external_control'), patch('modal_bridge.client', return_value=(object(),'destination')), \
             patch('destination_verifier_control.lookup_destination_verifier', return_value={'appId':'ap-dest'}), \
             patch('destination_verifier_control.ensure_destination_verifier') as deploy, \
             patch.object(host, 'AccountTransfer'), patch.object(host, 'advance', return_value={'cloud_stopped':False}) as advance:
            host.status(request, record, object(), state, cancel=True)
            deploy.assert_not_called()
            self.assertTrue(advance.call_args.kwargs['cancel'])
        self.assertEqual(state.get('dispatch:job')['verifier']['appId'], 'ap-dest')
        self.assertTrue(state.get('cancel:job'))

    def test_missing_destination_never_triggers_paid_redeploy_or_advance(self):
        state = State()
        record = {'workspace':'destination','fingerprint':host.FINGERPRINT}
        request = {'jobId':'job','credentials':{},'volume':'mashhad-model-1234abcd'}
        with patch.object(host, 'require_external_control'), patch('modal_bridge.client', return_value=(object(),'destination')), \
             patch('destination_verifier_control.lookup_destination_verifier', return_value=None), \
             patch('destination_verifier_control.ensure_destination_verifier') as deploy, patch.object(host, 'advance') as advance:
            result = host.status(request, record, object(), state)
            self.assertEqual(result['state'], 'setup_unknown')
            self.assertFalse(result['cloud_stopped'])
            self.assertEqual(result['events'][0]['phase'], 'destination_lookup')
            deploy.assert_not_called()
            advance.assert_not_called()


if __name__ == '__main__':
    unittest.main()
