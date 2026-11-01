"""Explicit independent watchdog; never deploys, builds, downloads or starts work.

Only exact fresh FLUX trial App shutdown is a mutation. Tokens stay in memory.
"""
import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import tomllib

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'services/film-engine/engine'))
from flux.trial_safety import TrialWatchdog, timestamp


class ModalTrialProvider:
    def __init__(self, token_id, token_secret, *, workspace, period_start):
        self.token_id, self.token_secret = token_id, token_secret
        self.workspace, self.period_start = workspace, period_start
        self.client = None

    async def connection(self):
        if self.client is None:
            from modal.client import _Client
            self.client = await _Client.from_credentials(self.token_id, self.token_secret)
        return self.client

    async def observe(self, state):
        from google.protobuf.timestamp_pb2 import Timestamp
        from modal_proto import api_pb2 as api
        c = await self.connection()
        listed = await asyncio.wait_for(c._stub.AppList(api.AppListRequest(environment_name='main')), 15)
        apps = []
        for row in listed.apps:
            name = row.name or row.description
            if row.state == api.APP_STATE_STOPPED and name != state['appName']:
                continue
            # Do not fetch private details of unrelated apps; their active presence
            # itself blocks the trial, and never authorizes stopping them.
            apps.append({'id': row.app_id, 'name': name, 'env': 'main',
                         'createdAt': int(row.created_at * 1000),
                         'state': 'stopped' if row.state == api.APP_STATE_STOPPED else 'active'})
        start = Timestamp()
        start.FromDatetime(datetime.fromtimestamp(timestamp(self.period_start) / 1000, timezone.utc))
        bill = await asyncio.wait_for(c._stub.WorkspaceBillingSummary(api.WorkspaceBillingSummaryRequest(start_timestamp=start)), 15)
        return {'workspace': self.workspace, 'env': 'main', 'apps': apps, 'grossUSD': bill.metered_cost}

    async def scoped_info(self, app_id, name, env):
        from modal_proto import api_pb2 as api
        c = await self.connection()
        info = (await asyncio.wait_for(c._stub.AppGetInfo(api.AppGetInfoRequest(app_id=app_id)), 15)).info
        if info.description != name or info.environment_name != env:
            raise ValueError('TRIAL_APP_SCOPE_INVALID')
        return c, info

    async def stop(self, app_id, name, env):
        from modal_proto import api_pb2 as api
        c, info = await self.scoped_info(app_id, name, env)
        if info.lifecycle.app_state != api.APP_STATE_STOPPED:
            await asyncio.wait_for(c._stub.AppStop(api.AppStopRequest(app_id=app_id, source=api.APP_STOP_SOURCE_CLI)), 20)

    async def confirm_stopped(self, app_id, name, env):
        from modal_proto import api_pb2 as api
        c, info = await self.scoped_info(app_id, name, env)
        tasks = await asyncio.wait_for(c._stub.TaskList(api.TaskListRequest(environment_name=env, app_id=app_id)), 15)
        return info.lifecycle.app_state == api.APP_STATE_STOPPED and len(tasks.tasks) == 0


def main():
    if len(sys.argv) != 2:
        raise ValueError('TRIAL_STATE_REQUIRED')
    state_path = Path(sys.argv[1]).absolute()
    if state_path.is_symlink() or state_path.resolve() != state_path or not state_path.is_file() or state_path.stat().st_size > 65536:
        raise ValueError('TRIAL_STATE_PATH_INVALID')
    state = json.loads(state_path.read_text(encoding='utf-8'))
    from flux.trial_safety import validate_lease, millis
    validate_lease(state, millis())
    profile = tomllib.loads((Path.home() / '.modal.toml').read_text(encoding='utf-8')).get('basm1998ali', {})
    token_id, token_secret = profile.get('token_id'), profile.get('token_secret')
    if not isinstance(token_id, str) or not token_id.startswith('ak-') or not isinstance(token_secret, str) or not token_secret.startswith('as-'):
        raise ValueError('TRIAL_PROFILE_UNAVAILABLE')
    import modal
    if modal.__version__ != '1.6.2':
        raise ValueError('TRIAL_SDK_VERSION')
    async def run_verified():
        from modal._workspace import _Workspace
        provider = ModalTrialProvider(token_id, token_secret, workspace='basm1998ali', period_start=state['periodStartISO'])
        client = await provider.connection()
        workspace = _Workspace.from_context(client=client)
        await workspace.hydrate()
        if workspace.name != 'basm1998ali':
            raise ValueError('TRIAL_WORKSPACE_MISMATCH')
        watcher = TrialWatchdog(state_path, provider)
        return await watcher.run()
    result = asyncio.run(run_verified())
    print(json.dumps({'watchdogStatus': result['status'], 'cloudStopped': result.get('cloudStopped'), 'stopReason': result.get('stopReason')}), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # SDK and HTTP error text may include credentials or request headers.
        print(json.dumps({'watchdogStatus': 'failed_closed', 'code': 'TRIAL_WATCHDOG_UNAVAILABLE'}), flush=True)
        raise SystemExit(1)
