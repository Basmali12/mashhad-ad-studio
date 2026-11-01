"""Approved five-shot continuation; one resident GPU call, durable per-shot results."""
import asyncio, hashlib, importlib.util, json, sys, time, tomllib, subprocess
from pathlib import Path
REPO=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(REPO/'services/film-engine/engine'))
BASE=(REPO/'../../work/afterlife-film-20261101').resolve()
WORK=BASE/'accelerated-film-batch1'
RUNTIME='afterlife-accelerated-five-1'
SHOTS=('phone','window','empty-chair','hands','road')
spec=importlib.util.spec_from_file_location('comparison_watch',REPO/'scripts/private-lightwan-comparison.py')
watch=importlib.util.module_from_spec(spec);spec.loader.exec_module(watch);watch.WORK=WORK
write=watch.write

def decode_video(file):
    ff=(REPO/'../../work/video-comparison-tools/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe').resolve()
    out=file.with_name(file.stem+'-contact.png')
    if not out.exists():subprocess.run([str(ff),'-v','error','-n','-i',str(file),'-vf','fps=2,scale=180:320,tile=5x2','-frames:v','1',str(out)],capture_output=True,check=True,timeout=60)

async def execute():
    import modal
    from wan.lightwan_modal import build_lightwan_app,validate_batch
    from wan.lightwan_runtime import manifest,fingerprint
    state=watch.read('intent.json');watch.guard(reserve_usd=1.15)
    with (WORK/'dispatch-claim.json').open('x') as f:json.dump({'at':watch.now(),'shots':SHOTS,'oneResidentBatch':True},f)
    c=state['config'];rows=json.loads((BASE/'continuation-requests.json').read_text())
    if tuple(r['shotId'] for r in rows)!=SHOTS:raise ValueError('SHOT_ORDER_INVALID')
    prior=json.loads((BASE/'lightwan-attempt2/preparation.json').read_text())
    if prior['manifestFingerprint']!=fingerprint(manifest()) or prior['hashVerified'] is not True:raise ValueError('WEIGHTS_CHANGED')
    items=[]
    for r in rows:
        raw=Path(r['referencePath']).read_bytes()
        if hashlib.sha256(raw).hexdigest()!=r['referenceSHA256']:raise ValueError('REFERENCE_CHANGED')
        items.append({'shotId':r['shotId'],'scope':{'engineId':c['engineId'],'accountId':c['accountId'],'runId':RUNTIME,'requestId':'afterlife-'+r['shotId']},'request':{'mode':'image_to_video','prompt':r['prompt'],'width':720,'height':1280,'seed':42,'num_frames':81,'fps':16,'reference_images':[raw]}})
    validate_batch(items,c,RUNTIME)
    p=watch.provider();client=await p.connection();from modal._workspace import _Workspace
    workspace=_Workspace.from_context(client=client);await workspace.hydrate()
    if workspace.name!='basm1998ali':raise ValueError('WRONG_WORKSPACE')
    obs=await watch.observe(p)
    if any(a['state']!='stopped' for a in obs['apps']):raise ValueError('OTHER_WORK_ACTIVE')
    credentials=tomllib.loads((Path.home()/'.modal.toml').read_text())['basm1998ali']
    sdk=await modal.Client.from_credentials.aio(credentials['token_id'],credentials['token_secret'])
    volume=modal.Volume.from_name(c['resultsVolume'],create_if_missing=False)
    await volume.hydrate.aio(client=sdk)
    async def read_file(relative):
        data=b''
        async for block in volume.read_file.aio(relative):data+=block
        return data
    saved=set()
    async def save_completed(records):
        for record in records:
            shot=record['shotId']
            if shot not in SHOTS:raise ValueError('FOREIGN_SHOT')
            if shot in saved:continue
            expected=items[SHOTS.index(shot)];source=rows[SHOTS.index(shot)]
            if record['scope']!=expected['scope'] or record['referenceSHA256']!=source['referenceSHA256'] or record['promptSHA256']!=hashlib.sha256(source['prompt'].encode()).hexdigest():raise ValueError('OUTPUT_SCOPE_CHANGED')
            data=await read_file('runs/'+RUNTIME+'/'+record['scope']['requestId']+'/video.mp4')
            if hashlib.sha256(data).hexdigest()!=record['sha256']:raise ValueError('OUTPUT_HASH_MISMATCH')
            path=WORK/(shot+'-native.mp4')
            with path.open('xb') as f:f.write(data)
            write(shot+'-receipt.json',{**record,'localPath':str(path),'sourceAssetId':source['sourceAssetId'],'costEstimatedResourcesUSD':(record['pipelineSeconds']+record['loadSecondsForThisShot'])*.00117856,'costNote':'Estimate for measured per-shot pipeline and first load only; startup, idle and shared charges recorded separately.'})
            decode_video(path);saved.add(shot)
            print(json.dumps({'phase':'clip_saved','shot':shot,'pipelineSeconds':record['pipelineSeconds'],'warmModelReused':record['modelWarmReused'],'saved':len(saved),'total':5}),flush=True)
    app,cls=build_lightwan_app(c);watch.guard(reserve_usd=1.15)
    write('progress.json',{'phase':'resident_batch_start','at':watch.now(),'shots':SHOTS})
    async with app.run(client=sdk,environment_name='main'):
        watch.guard()
        pending=asyncio.create_task(cls(runtime_id=RUNTIME).generate_batch.remote.aio(items))
        while not pending.done():
            await asyncio.wait({pending},timeout=4)
            if pending.done():break
            watch.guard()
            try:
                progress=json.loads(await asyncio.wait_for(read_file('runs/'+RUNTIME+'/batch-progress.json'),10))
                await save_completed(progress['completed'])
            except (modal.exception.NotFoundError, FileNotFoundError, asyncio.TimeoutError):pass
        result=await pending
        await save_completed(result['completed']);write('batch-result.json',result)
    write('control.json',{'status':'completed','settled':True})

async def main(command):
    if command=='watch':return await watch.watcher()
    if command!='execute':raise ValueError('COMMAND_INVALID')
    try:await execute()
    except BaseException as error:
        import traceback
        write('diagnostic.json',{'errorType':type(error).__name__,'frames':[{'file':Path(f.filename).name,'function':f.name,'line':f.lineno} for f in traceback.extract_tb(error.__traceback__)]})
        write('control.json',{'status':'failed','settled':True});raise
if __name__=='__main__':
    try:asyncio.run(main(sys.argv[1]))
    except Exception as error:
        print(json.dumps({'phase':'failed','errorType':type(error).__name__}),flush=True);raise SystemExit(1)
