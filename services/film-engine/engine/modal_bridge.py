"""Isolated Modal SDK 1.6.2 adapter. JSON-lines IPC; never emit raw SDK errors.
Read-only operations never instantiate an Image/App or create a Volume.
"""
import asyncio
import json
import os
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parent
from model_profile import MANIFEST, PREFIX, require_model


def emit(kind, data):
    print(json.dumps({'type': kind, 'data': data}, ensure_ascii=False), flush=True)


def client(credentials):
    import modal
    if modal.__version__ != '1.6.2':
        raise RuntimeError('Pinned Modal SDK required')
    if credentials.get('mode') == 'local_profile':
        result = modal.Client.from_env()
    else:
        result = modal.Client.from_credentials(credentials['tokenId'], credentials['tokenSecret'])
    workspace = modal.Workspace.from_context(client=result)
    workspace.hydrate()
    if credentials.get('expectedWorkspace') and workspace.name != credentials['expectedWorkspace']:
        raise RuntimeError('Workspace mismatch')
    return result, workspace.name


async def metadata(credentials, app_id=None, job_id=None, stop=False,include_billing=True,started_at=None):
    # Listing / scoped cancellation are not public high-level APIs in SDK 1.6.2.
    # Keep this version-pinned compatibility boundary isolated here.
    from modal.client import _Client
    from modal_proto import api_pb2 as api
    c = (await _Client.from_env() if credentials.get('mode') == 'local_profile'
         else await _Client.from_credentials(credentials['tokenId'], credentials['tokenSecret']))
    apps = None if app_id else await asyncio.wait_for(c._stub.AppList(api.AppListRequest(environment_name='main')), 20)
    if job_id and not app_id:
        owned=[a for a in apps.apps if a.description=='iff-engine-'+job_id]
        if len(owned)!=1:
            return {'cloud_stopped':False,'running_containers':None,'tasks':None,'state':'not_found_or_not_unique_unknown'}
        app_id=owned[0].app_id
    if app_id:
        # AppList can omit older/stopped Apps. Verify known IDs directly rather
        # than confusing an omitted App with a successful or failed stop.
        response=await asyncio.wait_for(c._stub.AppGetInfo(api.AppGetInfoRequest(app_id=app_id)),20)
        app=response.info
        if app.app_id!=app_id or app.description!='iff-engine-'+job_id or app.environment_name!='main':
            raise RuntimeError('Refuse cancellation of unowned application')
        if stop and app.lifecycle.app_state != api.APP_STATE_STOPPED:
            await asyncio.wait_for(c._stub.AppStop(api.AppStopRequest(app_id=app_id, source=api.APP_STOP_SOURCE_CLI)),20)
        for _ in range(8 if stop else 1):
            response=await asyncio.wait_for(c._stub.AppGetInfo(api.AppGetInfoRequest(app_id=app_id)),20)
            app=response.info
            tasks = await asyncio.wait_for(c._stub.TaskList(api.TaskListRequest(environment_name='main',app_id=app_id)),20)
            stopped = app.lifecycle.app_state == api.APP_STATE_STOPPED and not tasks.tasks
            if stopped or not stop:
                break
            await asyncio.sleep(1)
        billing = None
        try:
            if not include_billing:raise RuntimeError('Skip billing on heartbeat')
            from datetime import datetime, timezone, timedelta
            from modal._workspace import _Workspace
            from decimal import Decimal
            end = datetime.now(timezone.utc).replace(minute=0,second=0,microsecond=0)+timedelta(hours=1)
            start=datetime.fromtimestamp(started_at,timezone.utc).replace(minute=0,second=0,microsecond=0) if started_at else end-timedelta(days=1)
            rows = await asyncio.wait_for(_Workspace.from_context(client=c).billing.report(start=start,end=end,resolution='h'),15)
            rows = [r for r in rows if r.object_id == app_id]
            if rows:
                billing = {'usd':str(sum((r.cost for r in rows),Decimal(0))),'source':'Modal billing report','provisional':True}
        except Exception:
            pass  # unavailable is null, never a fabricated zero.
        return {'app_id':app_id,'running_containers':len(tasks.tasks),'tasks':len(tasks.tasks),'cloud_stopped':stopped,'recordedCost':billing}
    volumes = await asyncio.wait_for(c._stub.VolumeList(api.VolumeListRequest(environment_name='main')),20)
    relevant=[]
    for app in apps.apps:
        item={'id':app.app_id,'name':app.description,'containers':app.n_running_tasks,'state':app.state}
        if app.description.startswith(('iff-engine-','mashhad-model-')):
            try:
                layout=await asyncio.wait_for(c._stub.AppGetLayout(api.AppGetLayoutRequest(app_id=app.app_id)),10)
                item['functions']=list(layout.app_layout.function_ids.keys());item['classes']=list(layout.app_layout.class_ids.keys())
            except Exception:item['functions']=None
        relevant.append(item)
    task_count=None
    try:
        listed_tasks=await asyncio.wait_for(c._stub.TaskList(api.TaskListRequest(environment_name='main')),15)
        task_count=len(listed_tasks.tasks)
    except Exception:pass
    return {'apps':relevant,'runningTasks':task_count,
            'volumes':[{'name':v.label,'id':v.volume_id} for v in volumes.items]}



def discover(request):
    """Read metadata only; no image, transfer, volume creation or model download."""
    import modal
    c,workspace=client(request['credentials'])
    result=sync_metadata(request['credentials'])
    result.update(workspace=workspace,environment='main',files=[],ready=False,
                  capacity='unknown_until_paid_allocation',sdk=modal.__version__,
                  revision=MANIFEST.get('model_revision'),sourceCommit=MANIFEST.get('source_commit'),
                  profile=MANIFEST['id'],modelConfigured=MANIFEST.get('enabled') is True,
                  freeStorageQuotaBytes=None)
    if not MANIFEST.get('enabled') or not MANIFEST.get('files'):
        result['reason']='ENGINE_NOT_CONFIGURED'
        return result
    require_model()
    volume_name=request['volume']
    if volume_name not in [v['name'] for v in result['volumes']]:return result
    volume=modal.Volume.from_name(volume_name,create_if_missing=False,client=c,environment_name='main')
    try:entries={e.path.lstrip('/'):e for e in volume.listdir(PREFIX,recursive=True)}
    except Exception:return result
    for name,spec in MANIFEST['files'].items():
        entry=entries.get((PREFIX+'/'+name).lstrip('/'))
        if entry:
            result['files'].append({'name':name,'size':entry.size,'manifestMatch':entry.size==spec['size'],
                                    'expectedSHA256':spec['sha256'],'hashVerifiedNow':False})
    marker=entries.get((PREFIX+'/READY.json').lstrip('/'))
    if marker and marker.size<65536:
        saved=json.loads(b''.join(volume.read_file(PREFIX+'/READY.json')))
        result['readyMarker']={'revision':saved.get('revision'),'present':True}
        result['ready']=saved.get('revision')==MANIFEST['model_revision'] and len(result['files'])==len(MANIFEST['files']) and all(f['manifestMatch'] for f in result['files'])
    result['integrityNote']='Names, sizes and READY revision checked. Model bytes are not downloaded during discovery.'
    return result


def quality_discover(request):
    result=discover(request)
    return {**result,'profile':MANIFEST['id'],
            'files':[{**entry,'present':entry['manifestMatch']} for entry in result['files']],
            'hashVerifiedNow':False}


def official_model_info(request):
    require_model()
    from huggingface_hub import hf_hub_download
    cache=Path(request['cacheDir']);cache.mkdir(parents=True,exist_ok=True,mode=0o700)
    result=[]
    for name,expected in MANIFEST['files'].items():
        info=hf_hub_download(repo_id=MANIFEST['model_repo'],revision=MANIFEST['model_revision'],filename=name,
                             token=request['hfCredentials']['HF_TOKEN'],cache_dir=cache,dry_run=True,endpoint='https://huggingface.co')
        if info.file_size!=expected['size']:raise RuntimeError('Official source size mismatch')
        result.append({'name':name,'size':info.file_size,'revision':MANIFEST['model_revision']})
    return {'files':result,'accessVerifiedBy':'official metadata requests','modelDownloaded':False}


def execute(request):
    action=request['action']
    if action in ('generate','session'):
        # No retired inference module, GPU definition or provider request remains.
        raise RuntimeError('ENGINE_NOT_CONFIGURED')
    if action=='verify':
        _,workspace=client(request['credentials'])
        return {'workspace':workspace,'verified':True,'capacity':'unknown'}
    if action=='discover':return discover(request)
    if action=='quality_discover':return quality_discover(request)
    if action in ('inspect','stop'):
        client(request['credentials'])
        return sync_metadata(request['credentials'],request['appId'],request['jobId'],action=='stop',started_at=request.get('startedAt'))
    if action=='transfer':
        require_model()
        raise RuntimeError('CLOUD_TRANSFER_REQUIRED')
    if action.startswith('cloud_transfer_'):
        from cloud_transfer_host import run
        return run(request)
    if action=='official_plan':return official_model_info(request)
    raise RuntimeError('Unsupported action')


def main():
    emit('result',execute(json.loads(sys.stdin.readline())))


def sync_metadata(*args,**kwargs):
    # Run internal RPCs on the SDK synchronizer's loop rather than a new loop.
    from modal._utils.async_utils import synchronize_api
    return synchronize_api(metadata)(*args,**kwargs)


if __name__=='__main__':
    try:main()
    except BaseException as error:
        code='ENGINE_NOT_CONFIGURED' if str(error)=='ENGINE_NOT_CONFIGURED' else 'MODAL_OPERATION_FAILED'
        emit('error',{'code':code})
        sys.exit(1)
