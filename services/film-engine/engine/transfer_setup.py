"""Safe, durable setup checkpoints. Never persist exception text or credentials."""
import time

PHASES = frozenset(('destination_lookup', 'destination_deploy', 'destination_registry',
                    'destination_function', 'destination_metadata', 'destination_ready'))
ERROR_CLASSES = frozenset(('AuthError', 'NotFoundError', 'PermissionError', 'InvalidError',
    'VersionError', 'RemoteError', 'ExecutionError', 'TimeoutError', 'ConnectionError',
    'OSError', 'RuntimeError', 'ValueError', 'TypeError', 'FileNotFoundError'))


def checkpoint(state, key, record, phase, error=None):
    if phase not in PHASES:
        raise ValueError('INVALID_SETUP_PHASE')
    record['setup'] = {'phase':phase, 'updatedAt':time.time(),
                       'status':'uncertain' if error else 'ready' if phase == 'destination_ready' else 'running'}
    if error is not None:
        record['setup']['errorCode'] = 'TRANSFER_DESTINATION_SETUP_UNCONFIRMED'
        name = type(error).__name__
        record['setup']['errorClass'] = name if name in ERROR_CLASSES else 'UnknownError'
    state.put(key, record)


def setup_events(record):
    setup = record.get('setup', {})
    phase = setup.get('phase', 'destination_lookup')
    if phase not in PHASES:
        phase = 'destination_lookup'
    return [{'sequence':1, 'kind':'phase_error' if setup.get('status') == 'uncertain' else 'phase_start',
             'phase':phase, 'error_type':setup.get('errorCode', 'TRANSFER_DESTINATION_SETUP_PENDING')}]
