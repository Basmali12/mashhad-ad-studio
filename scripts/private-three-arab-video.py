"""One new accelerated Wan shot, using saved narration and successful clips.
Private owner test only; no production deployment, wallet or rental mutation.
"""
import asyncio,hashlib,importlib.util,json,sys,tomllib
from pathlib import Path
REPO=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(REPO/'services/film-engine/engine'))
BASE=(REPO/'../../work/afterlife-film-20261101').resolve()
WORK=(REPO/'../../work/three-arab-video-trial1').resolve()
RUNTIME='three-arab-video-trial1'
spec=importlib.util.spec_from_file_location('bounded_video_watch',REPO/'scripts/private-three-arab-audition.py')
watch=importlib.util.module_from_spec(spec);spec.loader.exec_module(watch)
watch.WORK=WORK;watch.APP='mashhad-lightwan-d830d93c394d'
write=watch.write

async def execute():
 import modal
 from modal._workspace import _Workspace
 from wan.lightwan_modal import build_lightwan_app
 from wan.lightwan_runtime import manifest,fingerprint
 s=watch.read('intent.json');watch.guard(.55)
 prior=json.loads((BASE/'lightwan-attempt2/preparation.json').read_text())
 if prior.get('manifestFingerprint')!=fingerprint(manifest()) or prior.get('hashVerified') is not True:raise ValueError('LIGHTWAN_WEIGHT_PROOF_CHANGED')
 image=Path(s['referencePath']).read_bytes()
 if hashlib.sha256(image).hexdigest()!=s['referenceSHA256']:raise ValueError('REFERENCE_CHANGED')
 p=watch.provider();client=await p.connection();ws=_Workspace.from_context(client=client);await ws.hydrate()
 if ws.name!='basm1998ali':raise ValueError('WRONG_WORKSPACE')
 obs=await p.observe({'appName':watch.APP})
 if any(a['state']!='stopped' for a in obs['apps']):raise ValueError('OTHER_WORK_ACTIVE')
 c=tomllib.loads((Path.home()/'.modal.toml').read_text(encoding='utf-8'))['basm1998ali']
 sdk=await modal.Client.from_credentials.aio(c['token_id'],c['token_secret'])
 # Read-only recovery of the already-generated narration's actual source claim.
 volume=modal.Volume.from_name(s['config']['modelVolume'],create_if_missing=False)
 await volume.hydrate.aio(client=sdk);claim=b''
 async for block in volume.read_file.aio('private-three-arab-audioseal-v1/trial2/trial2-solemn.claim'):claim+=block
 write('audio-claim.json',json.loads(claim))
 with (WORK/'dispatch-claim.json').open('x') as f:json.dump({'at':watch.now(),'gpuCallsMaximum':1,'successfulShotsRegenerated':False},f)
 app,cls=build_lightwan_app(s['config'],trial_limits={'timeout':180,'startupTimeout':180})
 request={'mode':'image_to_video','prompt':s['prompt'],'width':720,'height':1280,'seed':42,'num_frames':81,'fps':16,'reference_images':[image]}
 scope={'engineId':s['config']['engineId'],'accountId':s['config']['accountId'],'runId':RUNTIME,'requestId':'doorway-new-shot'}
 async with app.run(client=sdk,environment_name='main'):
  watch.guard(.50);write('progress.json',{'stage':'model_loading_and_new_motion','at':watch.now()})
  result=await cls(runtime_id=RUNTIME).generate.remote.aio(request,scope)
  raw=result.pop('mp4Bytes')
  if hashlib.sha256(raw).hexdigest()!=result['sha256']:raise ValueError('VIDEO_HASH_MISMATCH')
  with (WORK/'doorway-native.mp4').open('xb') as f:f.write(raw)
  write('video-result.json',result)
 write('progress.json',{'stage':'video_saved','at':watch.now()});write('control.json',{'status':'completed','settled':True})

async def main():
 if len(sys.argv)!=2 or sys.argv[1] not in ('watch','execute'):raise ValueError('COMMAND_REQUIRED')
 if sys.argv[1]=='watch':return await watch.watcher()
 try:await execute()
 except BaseException as e:
  import traceback
  write('diagnostic.json',{'errorType':type(e).__name__,'frames':[{'file':Path(f.filename).name,'function':f.name,'line':f.lineno} for f in traceback.extract_tb(e.__traceback__)]})
  write('control.json',{'status':'failed','settled':True});raise

if __name__=='__main__':
 try:asyncio.run(main())
 except BaseException as e:print(json.dumps({'status':'failed_closed','errorType':type(e).__name__}));raise SystemExit(1)
