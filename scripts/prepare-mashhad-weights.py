"""Owner-approved 2026-10-31 CPU download batch. No GPU or site publication.

No retries: a durable dispatch intent is written before resource creation.
The original FLUX trial baseline and global budget remain unchanged.
"""
import json
import copy
from pathlib import Path
import sys
import time
import tomllib
import uuid

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'services/film-engine/engine'))
from weight_batch import model_profile, build_cpu_app, validate_plan
from flux.trial_safety import transient_read_error

RECOVERY='--approved-hunyuan-recovery-once' in sys.argv
ATTEMPT=4 if '--approved-continuation-2' in sys.argv else 3 if '--approved-continuation-1' in sys.argv or RECOVERY else 2 if '--approved-attempt-2' in sys.argv else 1
COMMAND=[arg for arg in sys.argv[1:] if arg not in ('--approved-attempt-2','--approved-continuation-1','--approved-continuation-2','--approved-hunyuan-recovery-once')]
FOLDER=(ROOT/('../../work/mashhad-weights-primary-20261031'+('-attempt'+str(ATTEMPT) if ATTEMPT>1 else ''))).resolve()


def bounded_read(work,*,retry_timeout=True):
    try:return work()
    except Exception as error:
        if not transient_read_error(error) or (isinstance(error,TimeoutError) and not retry_timeout):raise
        time.sleep(0.5)
        return work()


def read_receipt(volume,receipt_path='batch.json'):
    # Modal 1.6.2 Volume.read_file translates NotFoundError into the built-in
    # FileNotFoundError. A missing first checkpoint is normal during startup.
    try:return bounded_read(lambda:json.loads(b''.join(volume.read_file(receipt_path))))
    except FileNotFoundError:return None


def write(path,value):
    temporary=path.with_suffix(path.suffix+'.pending');temporary.write_text(json.dumps(value,indent=2));temporary.replace(path)


def guard(plan):
    state=json.loads((FOLDER/'watchdog-state.json').read_text())
    controls=json.loads((FOLDER/'watchdog-state.json.control.json').read_text())
    now=int(time.time()*1000)
    limit_ok=state['usageLimitUSD']==26 if ATTEMPT<=2 else state['usageLimitUSD']==7 and state.get('twoPeriodCapApproved') is True and plan.get('resume') is True
    if state['appName']!=plan['appName'] or state['account']!='basm1998ali' or not limit_ok or state['spendLimitUSD']!=0 or state['trialMaxUSD']!=20:
        raise ValueError('WEIGHTS_BUDGET_GUARD_CLOSED')
    if state['status'] not in ('armed','watching') or state.get('stopReason') or controls.get('stopRequested') or controls.get('mainStatus')!='running':raise ValueError('WEIGHTS_WATCHDOG_NOT_ARMED')
    if not 0<=now-state.get('heartbeatAt',0)<20000 or now>=state['deadline'] or float(state['currentGrossUSD'])-state['baselineGrossUSD']>=18:
        raise ValueError('WEIGHTS_BUDGET_GUARD_CLOSED')
    financial_bound=26-state['baselineGrossUSD'] if ATTEMPT<=2 else 14-state['baselineGrossUSD']
    if not 0<financial_bound<=20 or state['storageGiBUpperBound']>500 or state['freeStorageGiB']!=1024:raise ValueError('WEIGHTS_BUDGET_GUARD_CLOSED')


def initialize():
    FOLDER.mkdir(parents=True,exist_ok=True)
    target=FOLDER/'plan.json'
    if target.exists():raise ValueError('WEIGHTS_PLAN_ALREADY_EXISTS')
    if ATTEMPT>2:
        prior=ROOT/('../../work/mashhad-weights-primary-20261031-attempt'+str(ATTEMPT-1))
        watcher=json.loads((prior/'watchdog-state.json').read_text())
        result=json.loads((prior/'latest-result.json').read_text())
        lines=(prior/'batch.log').read_text().strip().splitlines()
        last=json.loads(lines[-1]) if lines else {}
        normal_time_stop=watcher.get('stopReason')=='TRIAL_DEADLINE_REACHED'
        if watcher.get('stopReason')=='TRIAL_MAIN_FINISHED' and watcher.get('stoppedAt',0)>=watcher['deadline']:
            normal_time_stop=last.get('error')=='WEIGHTS_BUDGET_GUARD_CLOSED'
        failed_models={row['modelId'] for row in result['results'] if row['status']=='failed'}
        already_done={row['modelId'] for row in result['results'] if row['status'] in ('completed','blocked')}
        remaining_models={row['modelId'] for row in json.loads((prior/'plan.json').read_text())['models']} - already_done
        manual_recovery=RECOVERY and ATTEMPT==3 and last.get('safeErrorType')=='ConnectionError' and failed_models<= {'hunyuanvideo15'} and remaining_models<= {'hunyuanvideo15','audar-tts-v1-flash'} and result['status'] in ('running','failed')
        if watcher.get('cloudStopped') is not True or not ((normal_time_stop and result['status']=='running') or manual_recovery):raise ValueError('WEIGHTS_NOT_A_TIME_CONTINUATION')
        plan=copy.deepcopy(json.loads((prior/'plan.json').read_text()))
        done={row['modelId'] for row in result['results'] if row['status'] in ('completed','blocked')}
        plan['models']=[row for row in plan['models'] if row['modelId'] not in done]
        if not plan['models']:raise ValueError('WEIGHTS_NOTHING_REMAINING')
        plan.update(storageId=plan.get('storageId',plan['appName'][-12:]),resume=True,parentReceiptPath=plan.get('receiptPath','batch.json'))
        plan['appName']='mashhad-weights-'+uuid.uuid4().hex[:12];plan['receiptPath']='batch-'+plan['appName'][-12:]+'.json'
        validate_plan(plan);write(target,plan)
        print(json.dumps({'initializedContinuation':ATTEMPT-2,'models':[row['modelId'] for row in plan['models']],'reuseExistingVolumes':True,'gpuUsed':False}));return
    account_id=str(uuid.uuid4());batch_id=uuid.uuid4().hex[:12]
    rows=[]
    # Small audio models first; then images/main video, alternative video last.
    order=['habibi-irq','habibi-egy','habibi-msa','qwen-image-edit-2511','wan22-i2v-a14b','hunyuanvideo15','audar-tts-v1-flash']
    for model_id in order:
        manifest,fingerprint=model_profile(model_id)
        rows.append({'modelId':model_id,'engineId':str(uuid.uuid4()),'revision':manifest['revision'],'manifestFingerprint':fingerprint,'bytes':manifest['totalBytes']})
    plan={'approved':True,'workspace':'basm1998ali','accountId':account_id,'appName':'mashhad-weights-'+batch_id,
          'modelVolume':'mashhad-models-'+batch_id,'resultsVolume':'mashhad-preparations-'+batch_id,
          'hunyuanLicenseAccepted':True,'audarLicenseAccepted':True,'codecLicenseAccepted':True,
          'hfSecretPresent':False,'models':rows,'fluxPreservedOutsideBatch':True}
    validate_plan(plan);write(target,plan)
    print(json.dumps({'initialized':True,'appName':plan['appName'],'GiB':sum(r['bytes'] for r in rows)/1024**3,'models':order,'gpuUsed':False}))


def execute():
    import modal
    from modal.client import Client
    plan=json.loads((FOLDER/'plan.json').read_text());validate_plan(plan);guard(plan)
    intent=FOLDER/'paid-dispatch-intent.json'
    with intent.open('x') as stream:json.dump({'createdAt':int(time.time()*1000),'appName':plan['appName']},stream)
    credentials=tomllib.loads((Path.home()/'.modal.toml').read_text())['basm1998ali']
    client=Client.from_credentials(credentials['token_id'],credentials['token_secret'])
    # Secret metadata only; no token values fetched locally.
    from modal_proto import api_pb2 as api
    from modal._utils.async_utils import synchronize_api
    async def has_secret():
        from modal.client import _Client
        from modal._workspace import _Workspace
        connection=await _Client.from_credentials(credentials['token_id'],credentials['token_secret'])
        workspace=_Workspace.from_context(client=connection);await workspace.hydrate()
        if workspace.name!='basm1998ali':raise ValueError('WEIGHTS_WRONG_WORKSPACE')
        response=await connection._stub.SecretList(api.SecretListRequest(environment_name='main'))
        return any(row.label=='mashhad-hf-read' for row in response.items)
    plan['hfSecretPresent']=synchronize_api(has_secret)();write(FOLDER/'plan.json',plan)
    if plan.get('resume'):
        parent_volume=modal.Volume.from_name(plan['resultsVolume'],client=client,environment_name='main',create_if_missing=False)
        parent=read_receipt(parent_volume,plan['parentReceiptPath'])
        if not parent or parent.get('accountId')!=plan['accountId'] or parent.get('weightsOnly') is not True:raise ValueError('WEIGHTS_VOLUME_OWNERSHIP_UNCONFIRMED')
    for name in (plan['modelVolume'],plan['resultsVolume']):
        guard(plan);volume=modal.Volume.from_name(name,client=client,environment_name='main',create_if_missing=not plan.get('resume',False));volume.hydrate()
    guard(plan);app=build_cpu_app(plan);app.deploy(name=plan['appName'],client=client,environment_name='main')
    write(FOLDER/'cloud.json',{'appId':app.app_id,'appName':plan['appName']})
    guard(plan)
    call=modal.Function.from_name(plan['appName'],'prepare_batch',client=client,environment_name='main').spawn(plan)
    write(FOLDER/'call.json',{'functionCallId':call.object_id,'appId':app.app_id})
    print(json.dumps({'submitted':True,'appId':app.app_id,'gpuUsed':False}),flush=True)
    results=modal.Volume.from_name(plan['resultsVolume'],client=client,environment_name='main',create_if_missing=False)
    last=None
    while True:
        guard(plan)
        value=read_receipt(results,plan.get('receiptPath','batch.json'))
        if value and value!=last:
            write(FOLDER/'latest-result.json',value);print(json.dumps(value),flush=True);last=value
        if value and value['status'] in ('completed','completed_with_blockers','failed'):
            if value['status']=='failed':raise RuntimeError('WEIGHTS_BATCH_FAILED')
            break
        try:bounded_read(lambda:call.get(timeout=0),retry_timeout=False)
        except TimeoutError:pass
        time.sleep(5)
    write(FOLDER/'watchdog-state.json.control.json',{'mainStatus':'completed','stopRequested':True})


if __name__=='__main__':
    try:
        if COMMAND == ['init']:initialize()
        elif COMMAND == ['execute']:execute()
        else:raise ValueError('WEIGHTS_INVALID_COMMAND')
    except Exception as error:
        if COMMAND==['execute']:
            write(FOLDER/'watchdog-state.json.control.json',{'mainStatus':'failed','stopRequested':True})
        code=str(error) if type(error) in (ValueError,RuntimeError) and str(error).startswith('WEIGHTS_') else 'WEIGHTS_CONTROLLER_FAILED'
        print(json.dumps({'ok':False,'error':code,'safeErrorType':type(error).__name__}),flush=True)
        raise SystemExit(1)
