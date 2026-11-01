"""Fatal watchdog persistence/cancellation regressions; provider operations mocked."""
import asyncio
import ctypes
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'engine'))
from flux import trial_safety as safety
NOW=int(datetime(2026,10,31,19,0,tzinfo=timezone.utc).timestamp()*1000)
def lease():
    return dict(account='basm1998ali',profile='basm1998ali',env='main',appName='mashhad-flux-abcdef123456',appId=None,createdAt=NOW,baselineGrossUSD=6.34874585,usageLimitUSD=26,spendLimitUSD=0,trialMaxUSD=20,providerBudgetVerifiedAt=NOW,periodStartISO='2026-10-01T00:00:00Z',periodEndISO='2026-11-01T00:00:00Z',deadline=NOW+40*60000,approved=True)
class Provider:
    def __init__(self,late=False):self.stops=[];self.reads=0;self.late=late;self.active=True;self.confirmations=0;self.fail_confirmations=0
    async def observe(self,state):
        self.reads+=1
        apps=[] if self.late and self.reads==1 else [dict(id='ap-owned',name=lease()['appName'],env='main',createdAt=NOW+1000,state='active')]
        return dict(workspace='basm1998ali',env='main',grossUSD='7',apps=apps)
    async def stop(self,*args):self.stops.append(args)
    async def confirm_stopped(self,*args):
        self.confirmations+=1
        if self.confirmations<=self.fail_confirmations:return False
        self.active=False;return True
class AtomicWriteTests(unittest.TestCase):
    def test_transient_permission_error_retries_bounded_and_replaces_atomically(self):
        with tempfile.TemporaryDirectory() as folder:
            target=Path(folder)/'state.json';target.write_text('{"old":true}');real=Path.replace;attempts=[]
            def sharing_error(path,destination):
                attempts.append(1)
                if len(attempts)<3:raise PermissionError('synthetic sharing violation')
                return real(path,destination)
            with patch.object(Path,'replace',sharing_error),patch.object(safety.time,'sleep') as pause:safety.atomic_write(target,{'new':True})
            self.assertEqual(len(attempts),3);self.assertEqual(pause.call_count,2);self.assertEqual(json.loads(target.read_text()),{'new':True})
    def test_permanent_permission_error_retries_six_times_only(self):
        with tempfile.TemporaryDirectory() as folder:
            target=Path(folder)/'state.json';target.write_text('{"old":true}')
            with patch.object(Path,'replace',side_effect=PermissionError('not logged')) as replace,patch.object(safety.time,'sleep') as pause:
                with self.assertRaises(PermissionError):safety.atomic_write(target,{'new':True})
                self.assertEqual(replace.call_count,6);self.assertEqual(pause.call_count,5)
            self.assertEqual(json.loads(target.read_text()),{'old':True})
    @unittest.skipUnless(sys.platform=='win32','real Windows sharing lock regression')
    def test_actual_windows_reader_without_delete_share_is_tolerated(self):
        from ctypes import wintypes
        kernel=ctypes.WinDLL('kernel32',use_last_error=True)
        kernel.CreateFileW.argtypes=[wintypes.LPCWSTR,wintypes.DWORD,wintypes.DWORD,ctypes.c_void_p,wintypes.DWORD,wintypes.DWORD,wintypes.HANDLE];kernel.CreateFileW.restype=wintypes.HANDLE
        kernel.CloseHandle.argtypes=[wintypes.HANDLE];kernel.CloseHandle.restype=wintypes.BOOL
        with tempfile.TemporaryDirectory() as folder:
            target=Path(folder)/'state.json';target.write_text('{"old":true}')
            handle=kernel.CreateFileW(str(target),0x80000000,3,None,3,0,None)
            self.assertNotEqual(handle,ctypes.c_void_p(-1).value)
            # Reproduce the original unsafe replace against a real live reader.
            pending=target.with_suffix('.probe');pending.write_text('probe')
            with self.assertRaises(PermissionError):pending.replace(target)
            pending.unlink()
            timer=threading.Timer(0.12,lambda:kernel.CloseHandle(handle));timer.start()
            try:safety.atomic_write(target,{'new':True})
            finally:timer.join()
            self.assertEqual(json.loads(target.read_text()),{'new':True})
class FatalCleanupTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.path=Path(self.tmp.name)/'state.json';self.path.write_text(json.dumps(lease()))
    async def test_permanent_state_write_failure_stops_bound_app_before_exception_escapes(self):
        provider=Provider();watch=safety.TrialWatchdog(self.path,provider,now=lambda:NOW)
        with patch.object(safety,'atomic_write',side_effect=PermissionError('private failure not retained')):
            with self.assertRaises(PermissionError):await watch.run()
        self.assertFalse(provider.active);self.assertTrue(watch.done);self.assertTrue(watch.state['cloudStopped']);self.assertEqual(provider.stops,[('ap-owned',lease()['appName'],'main')]);self.assertEqual(watch.stop_reason,'TRIAL_STATE_WRITE_FAILED')
        self.assertNotIn('private failure',json.dumps(watch.state))
    async def test_uncaught_sleep_failure_executes_run_final_scoped_stop(self):
        async def failed_sleep(_):raise RuntimeError('private sleep failure')
        provider=Provider();watch=safety.TrialWatchdog(self.path,provider,now=lambda:NOW,sleep=failed_sleep)
        with self.assertRaises(RuntimeError):await watch.run()
        self.assertFalse(provider.active);self.assertTrue(watch.done);self.assertEqual(watch.stop_reason,'TRIAL_WATCHDOG_PROCESS_FAILED')
    async def test_fatal_write_before_binding_watches_for_and_stops_late_exact_app(self):
        provider=Provider(late=True);watch=safety.TrialWatchdog(self.path,provider,now=lambda:NOW)
        with patch.object(safety,'atomic_write',side_effect=PermissionError('fixture')):
            with self.assertRaises(PermissionError):await watch.run()
        self.assertEqual(provider.reads,2);self.assertFalse(provider.active);self.assertEqual(provider.stops[0][0],'ap-owned')
    async def test_unconfirmed_stop_keeps_cleanup_alive_until_provider_confirms(self):
        provider=Provider();provider.fail_confirmations=1;watch=safety.TrialWatchdog(self.path,provider,now=lambda:NOW)
        with patch.object(safety,'atomic_write',side_effect=PermissionError('fixture')):
            task=asyncio.create_task(watch.run());await asyncio.sleep(0.05);self.assertFalse(task.done());self.assertTrue(provider.active)
            with self.assertRaises(PermissionError):await task
        self.assertEqual(provider.confirmations,2);self.assertFalse(provider.active)
    async def test_external_cancellation_stops_bound_app_before_cancellation_propagates(self):
        sleeping=asyncio.Event()
        async def blocked_sleep(_):sleeping.set();await asyncio.Event().wait()
        provider=Provider();watch=safety.TrialWatchdog(self.path,provider,now=lambda:NOW,sleep=blocked_sleep);task=asyncio.create_task(watch.run());await sleeping.wait();task.cancel()
        with self.assertRaises(asyncio.CancelledError):await task
        self.assertFalse(provider.active);self.assertTrue(watch.done);self.assertEqual(provider.stops[0][0],'ap-owned')
if __name__=='__main__':unittest.main()
