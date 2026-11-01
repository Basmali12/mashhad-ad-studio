"""One approved private LightWan comparison. No HTTP/publication/rental mutation.
Run watcher separately before execute. Never retries a paid action.
"""
import asyncio, base64, hashlib, importlib.util, json, os
from pathlib import Path
import sqlite3, sys, time, tomllib

REPO=Path(__file__).resolve().parents[1]
ENGINE=REPO/'services/film-engine/engine'
sys.path.insert(0,str(ENGINE))
ATTEMPT=os.environ.get('LIGHTWAN_COMPARISON_ATTEMPT','1')
if ATTEMPT not in ('1','2','3','4','5','6'):raise ValueError('ATTEMPT_SCOPE_INVALID')
WORK=(REPO/('../../work/afterlife-film-20261101/lightwan-attempt'+ATTEMPT)).resolve()
PLAN=(REPO/'../../work/afterlife-film-20261101/lightwan-comparison-plan.json').resolve()
NAMES=('mashhad-lightwan-prepare-d830d93c394d','mashhad-lightwan-d830d93c394d','mashhad-lightwan-inspect-d830d93c394d')

def write(name,value):
    WORK.mkdir(parents=True,exist_ok=True)
    tmp=WORK/(name+'.tmp');tmp.write_text(json.dumps(value,indent=2),encoding='utf-8');tmp.replace(WORK/name)
def read(name):return json.loads((WORK/name).read_text(encoding='utf-8'))
def now():return int(time.time()*1000)
def provider():
    spec=importlib.util.spec_from_file_location('comparison_watch',REPO/'scripts/flux-trial-watchdog.py')
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    p=tomllib.loads((Path.home()/'.modal.toml').read_text(encoding='utf-8'))['basm1998ali']
    return m.ModalTrialProvider(p['token_id'],p['token_secret'],workspace='basm1998ali',period_start='2026-11-01T00:00:00Z')
async def observe(p):
    o=await p.observe({'appName':NAMES[0]})
    return o
async def watcher():
    p=provider();bound={};stopping=False
    from modal_proto import api_pb2 as api
    while True:
        state=read('intent.json')
        control=read('control.json') if (WORK/'control.json').exists() else {}
        try:
            obs=await asyncio.wait_for(observe(p),20)
            if float(obs['grossUSD'])>=6.00 or now()>=state['deadline'] or control.get('status') in ('completed','failed'):
                stopping=True
            active=[a for a in obs['apps'] if a['state']!='stopped']
            if any(a['name'] not in NAMES for a in active):stopping=True
            for a in active:
                if a['name'] in NAMES and a['createdAt']>=state['createdAt']-5000:
                    if a['name'] in bound and bound[a['name']]!=a['id']:raise RuntimeError('APP_REPLACED')
                    bound[a['name']]=a['id']
            if stopping:
                for name,app in bound.items():await p.stop(app,name,'main')
            stopped=all([await p.confirm_stopped(app,name,'main') for name,app in bound.items()]) if bound else False
            result={'heartbeatAt':now(),'grossUSD':obs['grossUSD'],'stopping':stopping,'boundApps':bound,'cloudStopped':stopped,'status':'watching'}
            if stopping and stopped and control.get('settled') is True:
                result['status']='stopped';write('watchdog.json',result);return
            if stopping and not bound and control.get('settled') is True and not active:
                result.update(status='not_dispatched',cloudStopped=True);write('watchdog.json',result);return
            write('watchdog.json',result)
        except Exception:
            stopping=True
            for name,app in bound.items():
                try:await p.stop(app,name,'main')
                except Exception:pass
            write('watchdog.json',{'heartbeatAt':now(),'stopping':True,'cloudStopped':False,'boundApps':bound,'status':'uncertain'})
        await asyncio.sleep(4)

def guard(reserve_usd=0):
    s=read('intent.json');w=read('watchdog.json')
    if s.get('approved') is not True or now()>=s['deadline'] or now()-w['heartbeatAt']>20000 or w.get('stopping') is True or float(w['grossUSD'])>=6.00:
        raise RuntimeError('COMPARISON_GUARD_CLOSED')
    if 6.00-float(w['grossUSD']) < reserve_usd:
        raise RuntimeError('COMPARISON_FULL_WINDOW_BUDGET_UNAVAILABLE')

async def execute(resume_metadata=False):
    import modal
    from wan.lightwan_modal import build_lightwan_app,prepare_native,build_lightwan_image,inspect_native_stack
    from wan.image import build_preparation_image
    from wan.lightwan_runtime import manifest,fingerprint
    state=read('intent.json');guard(reserve_usd=1.15)
    if ATTEMPT in ('5','6'):
        for previous_attempt in ('5','6'):
            prior=PLAN.parent/('lightwan-attempt'+previous_attempt)
            if (prior/'result.json').exists() or (prior/'candidate-native.mp4').exists():
                raise RuntimeError('COMPARISON_SUCCESS_OR_OUTPUT_ALREADY_EXISTS')
    # Permanent local claim: a second invocation cannot repeat this attempt.
    with (WORK/('metadata-resume-claim.json' if resume_metadata else 'dispatch-claim.json')).open('x') as f:json.dump({'at':now(),'attempts':1},f)
    p=provider();client=await p.connection()
    from modal._workspace import _Workspace
    workspace=_Workspace.from_context(client=client);await workspace.hydrate()
    if workspace.name!='basm1998ali':raise RuntimeError('WRONG_WORKSPACE')
    observation=await observe(p)
    if any(a['state']!='stopped' for a in observation['apps']):raise RuntimeError('OTHER_WORK_ACTIVE')
    creds=tomllib.loads((Path.home()/'.modal.toml').read_text(encoding='utf-8'))['basm1998ali']
    sdkclient=await modal.Client.from_credentials.aio(creds['token_id'],creds['token_secret'])
    if resume_metadata:
        if (WORK/'progress.json').exists() or not (WORK/'metadata-reconciliation.json').exists():raise RuntimeError('NO_SPEND_NOT_PROVEN')
    c=state['config'];scope={'engineId':c['engineId'],'accountId':c['accountId'],'runId':'lightwan-comparison-'+ATTEMPT,'requestId':'clock-candidate-'+ATTEMPT}
    # Existing weight Volume only. Isolated result Volume stores this attempt.
    results=modal.Volume.from_name(c['resultsVolume'],create_if_missing=False,client=sdkclient)
    await results.hydrate.aio(client=sdkclient)
    previous = PLAN.parent / 'lightwan-attempt2' / 'preparation.json'
    if ATTEMPT in ('3','4','5','6'):
        # Do not rerun the already successful CPU stage or redownload weights.
        prior = json.loads(previous.read_text())
        expected = manifest()
        if prior.get('hashVerified') is not True or prior.get('manifestFingerprint') != fingerprint(expected) or any(prior.get(k) != c[k] for k in ('engineId', 'accountId')) or prior.get('files') != [{k: f[k] for k in ('path','size','sha256')} for f in expected['files']]:
            raise RuntimeError('LIGHTWAN_EXISTING_PREPARATION_UNCONFIRMED')
        write('preparation.json', {**prior, 'reusedFromAttempt': 2})
    else:
        prepapp=modal.App(NAMES[0]);weights=modal.Volume.from_name(c['modelVolume'],create_if_missing=False)
        prep=prepapp.function(image=build_preparation_image(modal),cpu=(2,2),memory=(8192,8192),timeout=1800,startup_timeout=180,retries=0,max_containers=1,min_containers=0,buffer_containers=0,scaledown_window=2,volumes={'/models':weights},include_source=False)(prepare_native)
        guard();write('progress.json',{'phase':'prepare','at':now()})
        async with prepapp.run(client=sdkclient,environment_name='main'):
            ready=await prep.remote.aio({'paidApproved':True,'manifestFingerprint':fingerprint(manifest()),'scope':scope},c)
            write('preparation.json',ready)
    if ATTEMPT == '4':
        guard();write('progress.json', {'phase': 'cpu_kernel_inspection', 'at': now()})
        inspect_app = modal.App(NAMES[2])
        inspect_function = inspect_app.function(image=build_lightwan_image(modal),
            cpu=(2,2), memory=(8192,8192), timeout=180, startup_timeout=180,
            retries=0, max_containers=1, min_containers=0, buffer_containers=0,
            scaledown_window=2, include_source=False)(inspect_native_stack)
        async with inspect_app.run(client=sdkclient, environment_name='main'):
            inspection = await inspect_function.remote.aio()
            write('kernel-inspection.json', inspection)
        if inspection.get('ready') is not True:
            raise RuntimeError('LIGHTWAN_CPU_KERNEL_INSPECTION_FAILED')
    if ATTEMPT in ('5','6'):
        inspection = json.loads((PLAN.parent / 'lightwan-attempt4' / 'kernel-inspection.json').read_text())
        if inspection.get('ready') is not True or inspection.get('kernelProof', {}).get('nvfp4OperatorsRegistered') is not True:
            raise RuntimeError('LIGHTWAN_EXISTING_KERNEL_INSPECTION_UNCONFIRMED')
        write('kernel-inspection.json', {**inspection, 'reusedFromAttempt': 4})
    guard();write('progress.json',{'phase':'build_gpu_image','at':now()})
    app,cls=build_lightwan_app(c)
    guard(reserve_usd=1.15)
    async with app.run(client=sdkclient,environment_name='main'):
        guard()
        source=json.loads((PLAN.parent/'animate-clock-result.json').read_text())['artifacts'][0]
        image=Path(state['referencePath']).read_bytes()
        if hashlib.sha256(image).hexdigest()!=source['sourceSHA256']:raise RuntimeError('REFERENCE_CHANGED')
        request={'mode':'image_to_video','prompt':source['request']['prompt'],'width':720,'height':1280,'seed':42,'num_frames':81,'fps':16,'reference_images':[image]}
        guard();write('progress.json',{'phase':'generate_one','at':now()})
        # A single method initializes/loads then generates; no separate warmup/start.
        out=await cls(runtime_id=scope['runId']).generate.remote.aio(request,scope)
        video=out.pop('mp4Bytes');(WORK/'candidate-native.mp4').write_bytes(video)
        write('result.json',out)
    write('control.json',{'status':'completed','settled':True})

async def main(command):
    if command=='watch':return await watcher()
    if command not in ('execute','resume-metadata'):raise RuntimeError('COMMAND_INVALID')
    try:await execute(command=='resume-metadata')
    except BaseException as exc:
        import traceback
        frames=[{'file':Path(f.filename).name,'function':f.name,'line':f.lineno} for f in traceback.extract_tb(exc.__traceback__)]
        safe_code=str(exc) if str(exc).startswith(('LIGHTWAN_', 'COMPARISON_', 'NO_SPEND_')) and str(exc).replace('_','').isalnum() else type(exc).__name__
        write('diagnostic.json',{'errorType':type(exc).__name__,'code':safe_code,'frames':frames})
        write('control.json',{'status':'failed','settled':True})
        write('failure.json',{'code':'LIGHTWAN_ATTEMPT_FAILED','at':now(),'automaticRetry':False})
        raise
if __name__=='__main__':
    try:asyncio.run(main(sys.argv[1]))
    except Exception as exc:
        # No exception messages: provider errors may contain sensitive metadata.
        print(json.dumps({'status':'failed','errorType':type(exc).__name__}),flush=True)
        raise SystemExit(1)
