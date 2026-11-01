"""Explicit owner-approved slot registry binding; no cloud/paid operation."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess

spec=importlib.util.spec_from_file_location('deployment','/tmp/up.py')
d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
film,gateway,before=d.inspect()
# The new code must be deployed before this migration is used.
root=d.FILM_ROOT
required=root/'services/film-engine/engine/slot-model-bindings.mjs'
d.require(required.is_file(),'NEW_BINDING_CODE_REQUIRED')
script="""
import {openStore} from './services/film-engine/engine/open-store.mjs';
import {bindExistingSlots} from './services/film-engine/engine/slot-model-bindings.mjs';
const store=await openStore(process.env.FILM_DATA_DIR,process.env.ENGINE_MASTER_KEY);
try {const result=await bindExistingSlots({store,approved:true});console.log(JSON.stringify({cardsLinked:result.linked.length,definitions:(await store.all('engine-definition')).length,paidOperations:result.paidOperations,publishedWithoutTest:result.publishedWithoutTest}));} finally {await store.close();}
"""
stopped=False
try:
 d.run(['systemctl','stop',d.UNITS[0]]);stopped=True
 result=subprocess.run(['/opt/node-v24.14.1-linux-x64/bin/node','--input-type=module','-e',script],cwd=root,env={**os.environ,**film},capture_output=True,text=True,timeout=60)
 d.require(result.returncode==0,'SLOT_BINDING_FAILED')
 binding=json.loads(result.stdout.strip().splitlines()[-1])
 d.require(binding['paidOperations']==0 and binding['publishedWithoutTest']==0,'UNEXPECTED_PAID_ACTION')
 # Enable only quote/consent-gated OpenAI chat. GPU admission stays NO.
 path=d.ENV_FILES[0]
 source=path.read_text()
 lines=[line for line in source.splitlines() if not line.startswith('FILM_DIRECTOR_ENABLED=')]
 lines.append('FILM_DIRECTOR_ENABLED=YES')
 path.write_text('\n'.join(lines)+'\n')
 d.require(d.paid_execution_closed(d.envread(path)),'GPU_GATE_CHANGED')
 d.require(d.data_digest(film)==before['protectedDataDigest'],'PROTECTED_DATA_CHANGED')
finally:
 if stopped:subprocess.run(['systemctl','start',d.UNITS[0]],capture_output=True,timeout=60)
d.require(d.run(['systemctl','is-active',d.UNITS[0]])=='active','SERVICE_START_FAILED')
print(json.dumps({**binding,'directorEnabled':True,'GPUEnabled':False,'cloudCalls':0,'customerDataUnchanged':True}))
