"""STOP-ONLY private trial cleanup. Never deploys, downloads or starts work."""
import argparse
import asyncio
import importlib.util
import json
from pathlib import Path
import re
import sys
import time
import tomllib

ROOT = Path(__file__).resolve().parents[1]
PREFIXES = {'flux2-klein-4b':'flux','qwen-image-edit-2511': 'qwen', 'wan22-i2v-a14b': 'wan', 'hunyuanvideo15': 'hunyuan', 'habibi-irq': 'speech-habibi-irq', 'habibi-egy': 'speech-habibi-egy', 'habibi-msa': 'speech-habibi-msa'}
APP = re.compile(r'^ap-[A-Za-z0-9_-]+$')
KEY = re.compile(r'^[A-Za-z0-9_-]{1,100}$')
UUID = re.compile(r'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$')

class StopOnlyAppObserver:
    """Emergency shutdown discovery must not depend on billing availability."""
    async def observe(self, state):
        from modal_proto import api_pb2 as api
        client = await self.connection()
        listed = await asyncio.wait_for(client._stub.AppList(api.AppListRequest(environment_name='main')), 15)
        apps = []
        for row in listed.apps:
            name = row.name or row.description
            if row.state == api.APP_STATE_STOPPED and name != state['appName']:
                continue
            apps.append({'id': row.app_id, 'name': name, 'env': 'main',
                         'createdAt': int(row.created_at * 1000),
                         'state': 'stopped' if row.state == api.APP_STATE_STOPPED else 'active'})
        return {'workspace': self.workspace, 'env': 'main', 'apps': apps}


def validate_stop_scope(state, manifest, now):
    if not isinstance(state, dict) or not isinstance(manifest, dict) or state.get('approved') is not True or state.get('sequentialGpuTestsApproved') is not True:
        raise ValueError('PRIVATE_STOP_APPROVAL_REQUIRED')
    model, engine = state.get('modelId'), state.get('engineId', '')
    if model not in PREFIXES or not UUID.fullmatch(engine) or not KEY.fullmatch(state.get('accountId', '')):
        raise ValueError('PRIVATE_STOP_SCOPE_INVALID')
    film = state.get('filmTrialApproved') is True
    if film and (state.get('filmId') != 'afterlife-20261101' or manifest.get('filmId') != state.get('filmId') or model not in ('flux2-klein-4b','qwen-image-edit-2511','wan22-i2v-a14b','habibi-msa')) or model == 'flux2-klein-4b' and not film:
        raise ValueError('PRIVATE_STOP_SCOPE_INVALID')
    name = 'mashhad-' + PREFIXES[model] + '-' + engine.replace('-', '')[:12]
    if state.get('account') != 'basm1998ali' or state.get('profile') != 'basm1998ali' or state.get('env') != 'main' or state.get('environment', 'main') != 'main' or state.get('appName') != name:
        raise ValueError('PRIVATE_STOP_SCOPE_INVALID')
    if any(manifest.get(k) != state.get(k) for k in ['accountId', 'engineId', 'modelId', 'appName']) or manifest.get('workspace') != 'basm1998ali':
        raise ValueError('PRIVATE_STOP_MANIFEST_CHANGED')
    if type(state.get('createdAt')) is not int or not 0 < state['createdAt'] <= now + 1000:
        raise ValueError('PRIVATE_STOP_CLOCK_INVALID')
    bound = state.get('boundAppId') or state.get('appId')
    if bound is not None and (not isinstance(bound, str) or not APP.fullmatch(bound)) or state.get('boundAppId') and state.get('appId') and state['boundAppId'] != state['appId']:
        raise ValueError('PRIVATE_STOP_SCOPE_INVALID')
    return {'name': name, 'env': 'main', 'bound': bound, 'cutoff': state['createdAt'] - 5000}

async def stop_private_scope(state, manifest, provider, *, deployment_settled=False, attempts=6, interval=1, wait=asyncio.sleep, now=None):
    scope = validate_stop_scope(state, manifest, int(time.time()*1000) if now is None else now)
    target, confirmed = scope['bound'], False
    for index in range(attempts):
        observed = await provider.observe(state)
        if observed.get('workspace') != 'basm1998ali' or observed.get('env') != 'main':
            raise ValueError('PRIVATE_STOP_WORKSPACE_MISMATCH')
        same = [a for a in observed.get('apps', []) if a.get('name') == scope['name'] and a.get('env') == scope['env']]
        if target:
            matches = [a for a in same if a.get('id') == target]
            if any(a.get('id') == target for a in observed.get('apps', [])) and not matches:
                raise ValueError('PRIVATE_STOP_BOUND_SCOPE_CHANGED')
            if len(matches) > 1:
                raise ValueError('PRIVATE_STOP_APP_AMBIGUOUS')
        else:
            fresh = [a for a in same if type(a.get('createdAt')) is int and a['createdAt'] >= scope['cutoff']]
            if len(fresh) > 1:
                raise ValueError('PRIVATE_STOP_APP_AMBIGUOUS')
            matches = fresh
            if matches:
                target = matches[0].get('id')
                if not isinstance(target, str) or not APP.fullmatch(target):
                    raise ValueError('PRIVATE_STOP_APP_INVALID')
        if matches:
            app = matches[0]
            if type(app.get('createdAt')) is not int or app['createdAt'] < scope['cutoff']:
                raise ValueError('PRIVATE_STOP_APP_OLDER_THAN_LEASE')
            await provider.stop(target, scope['name'], scope['env'])
            confirmed = await provider.confirm_stopped(target, scope['name'], scope['env']) is True
            if confirmed:
                return {'cloudStopped': deployment_settled is True, 'appStopConfirmed': True, 'taskListZeroConfirmed': True, 'appId': target, 'deploymentSettled': deployment_settled is True, 'scopeOnly': True}
        elif deployment_settled and not target and not same:
            return {'cloudStopped': True, 'appAbsentAfterSettledDeployment': True, 'deploymentSettled': True, 'scopeOnly': True}
        if index + 1 < attempts:
            await wait(interval)
    return {'cloudStopped': False, 'appStopConfirmed': confirmed, 'taskListZeroConfirmed': confirmed, 'appId': target, 'deploymentSettled': deployment_settled is True, 'scopeOnly': True}

def load_json(filename):
    p = Path(filename).absolute()
    if p.is_symlink() or not p.is_file() or p.stat().st_size > 65536:
        raise ValueError('PRIVATE_STOP_PATH_INVALID')
    return json.loads(p.read_text(encoding='utf-8-sig'))

async def main(args):
    state, manifest = load_json(args.state), load_json(args.manifest)
    validate_stop_scope(state, manifest, int(time.time()*1000))
    spec = importlib.util.spec_from_file_location('private_stop_provider', ROOT/'scripts/flux-trial-watchdog.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    profile = tomllib.loads((Path.home()/'.modal.toml').read_text(encoding='utf-8')).get('basm1998ali', {})
    token_id, token_secret = profile.get('token_id'), profile.get('token_secret')
    if not isinstance(token_id, str) or not token_id.startswith('ak-') or not isinstance(token_secret, str) or not token_secret.startswith('as-'):
        raise ValueError('PRIVATE_STOP_PROFILE_UNAVAILABLE')
    import modal
    if modal.__version__ != '1.6.2':
        raise ValueError('PRIVATE_STOP_SDK_VERSION')
    from modal._workspace import _Workspace
    class StopOnlyProvider(StopOnlyAppObserver, module.ModalTrialProvider):
        pass
    provider = StopOnlyProvider(token_id, token_secret, workspace='basm1998ali', period_start=state['periodStartISO'])
    client = await provider.connection()
    workspace = _Workspace.from_context(client=client)
    await workspace.hydrate()
    if workspace.name != 'basm1998ali':
        raise ValueError('PRIVATE_STOP_WORKSPACE_MISMATCH')
    return await stop_private_scope(state, manifest, provider, deployment_settled=args.deployment_settled)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('state')
    parser.add_argument('manifest')
    parser.add_argument('--deployment-settled', action='store_true')
    args = parser.parse_args()
    try:
        result = asyncio.run(asyncio.wait_for(main(args), timeout=90))
        print(json.dumps(result), flush=True)
        raise SystemExit(0 if result.get('cloudStopped') else 2)
    except Exception:
        print(json.dumps({'cloudStopped': False, 'code': 'PRIVATE_STOP_UNCONFIRMED'}), flush=True)
        raise SystemExit(1)
