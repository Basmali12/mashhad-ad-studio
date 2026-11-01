"""Local host + read-only provider diagnostic, no resource creation or secrets output."""
import importlib.util,json,os,subprocess
spec=importlib.util.spec_from_file_location('deployment','/tmp/up.py');d=importlib.util.module_from_spec(spec);spec.loader.exec_module(d)
film,_,_=d.inspect()
script=r'''
import {spawnSync} from 'node:child_process';
import {openStore} from './services/film-engine/engine/open-store.mjs';
import {createModelModalTransport,fluxTransportEnvironment} from './services/film-engine/engine/flux-modal-transport.mjs';
import {createFluxRegistryAdapter} from './services/film-engine/engine/flux-integration.mjs';
const store=await openStore(process.env.FILM_DATA_DIR,process.env.ENGINE_MASTER_KEY);
try{
 const a=(await store.all('account')).find(a=>a.workspace==='basm1998ali');
 const e=(await store.all('engine-definition')).find(e=>e.accountId===a.id&&e.modelId==='flux2-klein-4b');
 const runner=async(action,payload)=>{
  if(action!=='inspect')throw Error('READ_ONLY_REQUIRED');
  const shim=`import runpy,json,traceback,os\nd=runpy.run_path('services/film-engine/engine/flux_modal_bridge.py')\ntry: d['main']()\nexcept BaseException as e: print(json.dumps({'diagnostic':type(e).__name__,'frames':[{'file':os.path.basename(f.filename),'line':f.lineno,'function':f.name} for f in traceback.extract_tb(e.__traceback__)]}))`;
  const r=spawnSync(process.env.ENGINE_PYTHON,['-c',shim],{input:JSON.stringify({action,...payload})+'\n',env:fluxTransportEnvironment(),encoding:'utf8',timeout:20000,maxBuffer:1000000});
  if(r.error){console.log(JSON.stringify({localError:r.error.code}));throw Error('DIAGNOSTIC_DONE');}
  const lines=r.stdout.trim().split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
  const diagnostic=lines.find(x=>x.diagnostic);if(diagnostic){console.log(JSON.stringify(diagnostic));throw Error('DIAGNOSTIC_DONE');}
  const result=lines.find(x=>x.type==='result')?.data;if(!result){console.log(JSON.stringify({localExit:r.status}));throw Error('DIAGNOSTIC_DONE');}return result;
 };
 const adapter=createFluxRegistryAdapter({transport:createModelModalTransport({store,modelId:'flux2-klein-4b',runner})});
 try{const r=await adapter.inspectFiles(e);console.log(JSON.stringify({readSucceeded:true,present:r.files.filter(f=>f.present).length,total:r.files.length,verified:r.files.filter(f=>f.verified).length,deploymentReady:r.deploymentReady}));}catch(e){if(e.message!=='DIAGNOSTIC_DONE')console.log(JSON.stringify({code:/^[A-Z_]+$/.test(e.message)?e.message:'LOCAL_DIAGNOSTIC_FAILED'}));}
}finally{await store.close();}
'''
r=subprocess.run(['/opt/node-v24.14.1-linux-x64/bin/node','--input-type=module','-e',script],cwd=d.FILM_ROOT,env={**os.environ,**film},capture_output=True,text=True,timeout=40)
for line in r.stdout.splitlines():
 try: print(json.dumps(json.loads(line)))
 except Exception:pass
if r.returncode:print(json.dumps({'localNodeExit':r.returncode,'secretsPrinted':False}))
