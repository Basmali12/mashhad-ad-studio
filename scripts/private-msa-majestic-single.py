"""Five owner-requested Habibi samples, primary account only, existing weights."""
import asyncio,json,hashlib,importlib.util,sys,tomllib,subprocess,time,wave,math,array
from pathlib import Path
REPO=Path(__file__).resolve().parents[1];sys.path.insert(0,str(REPO/'services/film-engine/engine'))
WORK=(REPO/'../../work/msa-majestic-single1').resolve()
REF=(REPO/'../../work/private-habibi-references').resolve()
spec=importlib.util.spec_from_file_location('sample_watch',REPO/'scripts/private-lightwan-comparison.py');watch=importlib.util.module_from_spec(spec);spec.loader.exec_module(watch);watch.WORK=WORK
from speech.modal_app import deployment_config,build_speech_app
from speech.runtime import validate_request,split_text
CONFIGS=json.loads((WORK/'configs.json').read_text(encoding='utf-8'));watch.NAMES=tuple(deployment_config(c)['appName'] for c in CONFIGS)

def request_for(sample):
    dialect=sample['modelId'].split('-')[-1].upper();raw=(REF/(dialect+'-16khz.wav')).read_bytes();transcript=(REF/(dialect+'-transcript.txt')).read_text(encoding='utf-8')
    refsha=hashlib.sha256(raw).hexdigest();fingerprint=hashlib.sha256(json.dumps([sample['modelId'],refsha,transcript],ensure_ascii=False).encode()).hexdigest()
    request={'text':sample['text'],'referenceTranscript':transcript,'voiceProfileId':'private-clear-'+dialect,'voiceProfileFingerprint':fingerprint,'characterId':None,'narrator':True,'utteranceId':sample['id'],'locale':sample['locale'],'expression':'neutral','seed':sample['seed'],'reference_audio':raw,'referenceSHA256':refsha,'speakingRate':sample['rate']}
    checked=validate_request(request,sample['modelId']);assert len(split_text(checked,sample['modelId']))==1
    return request

def preview_audio(sample,raw):
    import io
    with wave.open(io.BytesIO(raw),'rb') as f:
        pcm=array.array('h',f.readframes(f.getnframes()));peak=max(abs(v) for v in pcm)/32768
    gain=min(9,max(-12,-3-20*math.log10(max(peak,1e-8))))
    ff=(REPO/'../../work/video-comparison-tools/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe').resolve();target=WORK/(sample['id']+'.mp3')
    subprocess.run([str(ff),'-hide_banner','-v','error','-n','-i',str(WORK/(sample['id']+'-native.wav')),'-af','volume='+str(gain)+'dB','-ar','24000','-ac','1','-c:a','libmp3lame','-b:a','128k',str(target)],check=True,capture_output=True,timeout=60)
    return {'path':str(target),'gainDB':gain,'speedChangedAfterGeneration':False}

async def execute():
    import modal
    watch.guard(reserve_usd=.60)
    with (WORK/'dispatch-claim.json').open('x') as f:json.dump({'at':watch.now(),'samples':4},f)
    plan=json.loads((WORK/'samples-plan.json').read_text(encoding='utf-8'));samples=plan['samples']
    if len(samples)!=4:raise ValueError('SAMPLES_PLAN_INVALID')
    for s in samples:request_for(s)
    provider=watch.provider();rawclient=await provider.connection();from modal._workspace import _Workspace
    workspace=_Workspace.from_context(client=rawclient);await workspace.hydrate()
    if workspace.name!='basm1998ali':raise ValueError('WRONG_WORKSPACE')
    obs=await watch.observe(provider)
    if any(a['state']!='stopped' for a in obs['apps']):raise ValueError('OTHER_WORK_ACTIVE')
    creds=tomllib.loads((Path.home()/'.modal.toml').read_text(encoding='utf-8'))['basm1998ali'];client=await modal.Client.from_credentials.aio(creds['token_id'],creds['token_secret'])
    completed=[]
    for model in ('habibi-msa',):
        watch.guard(reserve_usd=.28)
        config=next(c for c in CONFIGS if c['modelId']==model);app,cls=build_speech_app(config)
        async with app.run(client=client,environment_name='main'):
            engine=cls(runtime_id='msa-majestic-single1')
            for sample in [s for s in samples if s['modelId']==model]:
                watch.guard()
                if (WORK/(sample['id']+'-receipt.json')).exists():raise ValueError('SUCCESSFUL_SAMPLE_EXISTS')
                scope={'engineId':config['engineId'],'accountId':config['accountId'],'runId':'msa-majestic-single1','requestId':sample['id']}
                result=await engine.generate.remote.aio(request_for(sample),scope)
                raw=result.pop('wavBytes');assert hashlib.sha256(raw).hexdigest()==result['metadata']['sha256']
                native=WORK/(sample['id']+'-native.wav')
                with native.open('xb') as f:f.write(raw)
                preview={'path':str(native),'processing':'native PCM, no gain or retime'};receipt={**result,'sample':sample,'nativePath':str(native),'preview':preview,'singleChunk':True,'listeningApproved':False}
                watch.write(sample['id']+'-receipt.json',receipt);completed.append(receipt)
                print(json.dumps({'phase':'sample_saved','id':sample['id'],'model':model,'durationMs':result['metadata']['durationMs'],'inferenceSeconds':result['metadata']['inferenceSeconds']}),flush=True)
    watch.write('samples-result.json',{'completed':completed,'count':4});watch.write('control.json',{'status':'completed','settled':True})

async def main(command):
    if command=='watch':return await watch.watcher()
    if command!='execute':raise ValueError('COMMAND_INVALID')
    try:await execute()
    except BaseException as e:
        import traceback
        watch.write('diagnostic.json',{'type':type(e).__name__,'frames':[{'file':Path(f.filename).name,'function':f.name,'line':f.lineno} for f in traceback.extract_tb(e.__traceback__)]});watch.write('control.json',{'status':'failed','settled':True});raise
if __name__=='__main__':
    try:asyncio.run(main(sys.argv[1]))
    except Exception as e:print(json.dumps({'phase':'failed','errorType':type(e).__name__}));raise SystemExit(1)
