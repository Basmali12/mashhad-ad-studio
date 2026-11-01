"""Owner-requested private two-voice trial; no deployment or rental mutation.

Run the independent watch command before execute. One permanent dispatch claim
and one GPU batch containing at most the two approved styles. No retry.
"""
import asyncio
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import time
import tomllib

REPO=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(REPO/'services/film-engine/engine'))
from three_arab.modal_trial import APP,build_trial
ATTEMPT=os.environ.get('THREE_ARAB_ATTEMPT','1')
if ATTEMPT not in ('1','2','3','4','5','6'):raise ValueError('TRIAL_ATTEMPT_LIMIT')
WORK=(REPO/('../../work/three-arab-audioseal-audition'+ATTEMPT)).resolve()

def now():return int(time.time()*1000)
def read(name):return json.loads((WORK/name).read_text(encoding='utf-8'))
def write(name,value):
 WORK.mkdir(parents=True,exist_ok=True);p=WORK/(name+'.tmp')
 p.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8');p.replace(WORK/name)

def provider():
 spec=importlib.util.spec_from_file_location('private_watch',REPO/'scripts/flux-trial-watchdog.py')
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 c=tomllib.loads((Path.home()/'.modal.toml').read_text(encoding='utf-8'))['basm1998ali']
 return module.ModalTrialProvider(c['token_id'],c['token_secret'],workspace='basm1998ali',period_start='2026-11-01T00:00:00Z')

async def watcher():
 p=provider();bound={};stopping=False
 while True:
  s=read('intent.json');control=read('control.json') if (WORK/'control.json').exists() else {}
  try:
   obs=await asyncio.wait_for(p.observe({'appName':APP}),20)
   active=[a for a in obs['apps'] if a['state']!='stopped']
   if float(obs['grossUSD'])>=s['stopAtGrossUSD'] or now()>=s['deadline'] or control.get('status') in ('completed','failed') or any(a['name']!=APP for a in active):stopping=True
   for a in active:
    if a['name']==APP and a['createdAt']>=s['createdAt']-5000:
     if APP in bound and bound[APP]!=a['id']:raise RuntimeError('TRIAL_APP_REPLACED')
     bound[APP]=a['id']
   if stopping:
    for name,app in bound.items():await p.stop(app,name,'main')
   stopped=all([await p.confirm_stopped(app,name,'main') for name,app in bound.items()]) if bound else not any(a['name']==APP for a in active)
   value={'heartbeatAt':now(),'grossUSD':obs['grossUSD'],'stopping':stopping,'boundApps':bound,'cloudStopped':stopped,'status':'watching'}
   if stopping and stopped and control.get('settled') is True:value['status']='stopped';write('watchdog.json',value);return
   write('watchdog.json',value)
  except Exception:
   stopping=True
   for name,app in bound.items():
    try:await p.stop(app,name,'main')
    except Exception:pass
   write('watchdog.json',{'heartbeatAt':now(),'stopping':True,'cloudStopped':False,'boundApps':bound,'status':'uncertain'})
  await asyncio.sleep(4)

def guard(reserve):
 s=read('intent.json');w=read('watchdog.json')
 if s.get('approved') is not True or s.get('usageLimit')!=6.35 or s.get('spendLimit')!=0 or s.get('account')!='basm1998ali' or now()>=s['deadline'] or now()-w['heartbeatAt']>20000 or w.get('stopping') or s['stopAtGrossUSD']-float(w['grossUSD'])<reserve:
  raise RuntimeError('THREE_ARAB_TRIAL_GUARD_CLOSED')

async def execute():
 import modal
 from modal._workspace import _Workspace
 from three_arab.runtime import validate_request
 intent=read('intent.json');guard(.35)
 requests=intent['requests']
 for r in requests:validate_request(r)
 if len(requests)!=2 or [r['style'] for r in requests]!=['solemn','calm'] or requests[0]['text']!=requests[1]['text']:raise ValueError('TRIAL_REQUEST_SCOPE_INVALID')
 p=provider();client=await p.connection();workspace=_Workspace.from_context(client=client);await workspace.hydrate()
 if workspace.name!='basm1998ali':raise ValueError('WRONG_WORKSPACE')
 obs=await p.observe({'appName':APP})
 if any(a['state']!='stopped' for a in obs['apps']):raise ValueError('OTHER_WORK_ACTIVE')
 c=tomllib.loads((Path.home()/'.modal.toml').read_text(encoding='utf-8'))['basm1998ali']
 sdkclient=await modal.Client.from_credentials.aio(c['token_id'],c['token_secret'])
 with (WORK/'dispatch-claim.json').open('x',encoding='utf-8') as f:json.dump({'at':now(),'requestsSHA256':hashlib.sha256(json.dumps(requests,ensure_ascii=False,sort_keys=True).encode()).hexdigest()},f)
 app,prepare,inspect,generate=build_trial()
 async with app.run(client=sdkclient,environment_name='main'):
  guard(.30);write('progress.json',{'stage':'prepare'})
  if intent.get('reuseVerifiedPreparation'):
   prior=Path(intent['reuseVerifiedPreparation']);preparation=json.loads(prior.read_text(encoding='utf-8'))
   if preparation.get('ready') is not True:raise RuntimeError('PREPARATION_NOT_VERIFIED')
  else:preparation=await prepare.remote.aio()
  write('preparation.json',preparation)
  guard(.25);write('progress.json',{'stage':'cpu_preflight'})
  inspection=await inspect.remote.aio();write('inspection.json',inspection)
  if inspection.get('imports') is not True:raise RuntimeError('NATIVE_PREFLIGHT_FAILED')
  guard(.23);write('progress.json',{'stage':'gpu_two_voice_batch'})
  result=await generate.remote.aio(requests)
  samples=[]
  for sample in result['samples']:
   receipt=sample['receipt'];name=receipt['request']['style'];raw=sample['wavBytes']
   if hashlib.sha256(raw).hexdigest()!=receipt['result']['sha256']:raise RuntimeError('TRIAL_OUTPUT_HASH_CHANGED')
   with (WORK/(name+'-native.wav')).open('xb') as f:f.write(raw)
   source=sample.get('sourceFloatBytes')
   if source:
    if hashlib.sha256(source).hexdigest()!=receipt['result']['sourceSHA256']:raise RuntimeError('TRIAL_SOURCE_HASH_CHANGED')
    with (WORK/(name+'-source-f32.wav')).open('xb') as f:f.write(source)
   write(name+'-receipt.json',receipt);samples.append({'style':name,'bytes':len(raw),'receipt':receipt})
  write('result.json',{'samples':samples,'failureType':result.get('failureType'),'listeningApproved':False})
  if result.get('failureType') or len(samples)!=2:raise RuntimeError('TRIAL_INCOMPLETE_NO_RETRY')
 write('progress.json',{'stage':'completed'});write('control.json',{'status':'completed','settled':True})

async def main():
 if len(sys.argv)!=2 or sys.argv[1] not in ('watch','execute'):raise ValueError('COMMAND_REQUIRED')
 if sys.argv[1]=='watch':return await watcher()
 try:await execute()
 except BaseException as e:
  import traceback
  write('diagnostic.json',{'errorType':type(e).__name__,'frames':[{'file':Path(f.filename).name,'function':f.name,'line':f.lineno} for f in traceback.extract_tb(e.__traceback__)]})
  write('control.json',{'status':'failed','settled':True});raise

if __name__=='__main__':
 try:asyncio.run(main())
 except BaseException as e:print(json.dumps({'status':'failed_closed','errorType':type(e).__name__}),flush=True);raise SystemExit(1)
