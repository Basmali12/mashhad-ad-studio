// Read-only inspection of the single owner-approved attempt. Never deploy/spawn.
import fs from 'node:fs';
import {spawnSync,execFileSync} from 'node:child_process';
const base='/srv/iraq-ai-studio-staging/current/services/film-engine/engine';
const pid=execFileSync('systemctl',['show','-p','MainPID','--value','iraq-ai-film-platform-staging'],{encoding:'utf8'}).trim();
if(!/^[1-9][0-9]*$/.test(pid))throw Error('SERVICE_NOT_RUNNING');
for(const entry of fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0')){
 const i=entry.indexOf('=');if(i>0&&/^(ENGINE_|LTX_|FILM_DATA_DIR=)/.test(entry))process.env[entry.slice(0,i)]=entry.slice(i+1);
}
for(const line of fs.readFileSync('/etc/iraq-ai-film-platform-staging/film.env','utf8').split('\n')){
 const i=line.indexOf('=');if(i>0&&!line.startsWith('#'))process.env[line.slice(0,i)]=line.slice(i+1);
}
const {PostgresStore}=await import(base+'/postgres.mjs');
const {masterKey}=await import(base+'/keyring.mjs');
const folder=process.env.FILM_DATA_DIR||process.env.ENGINE_DATA_DIR;
if(!folder)throw Error('SERVICE_DATA_PATH_UNAVAILABLE');
const store=new PostgresStore(folder,masterKey(folder));
try{
 await store.ready();const job=await store.get('job','de473f07-a395-48d3-891e-cd7c55f822e3');
 if(job?.action!=='prepare'||job.accountId!=='0e77a689-6b46-493a-827c-346091f5c76b')throw Error('SCOPE_MISMATCH');
 const source=await store.get('account',job.sourceId),dest=await store.get('account',job.accountId);
 const credentials=a=>({...store.open(a.credentials,a.id),expectedWorkspace:a.workspace});
 const input={source:credentials(source),credentials:credentials(dest),jobId:job.id,volume:dest.volume,workerApp:job.plan.workerApp};
 const code=`import sys,json,pathlib,traceback
sys.path.insert(0,${JSON.stringify(base)})
request=json.loads(sys.stdin.readline())
from cloud_transfer_host import control
from modal_bridge import client
from destination_verifier_control import lookup_destination_verifier
from transfer_contract import verifier_names
c,state=control(request)
r=state.get('dispatch:'+request['jobId'],{})
result={'setup':r.get('setup'),'verifierRecorded':bool(r.get('verifier')),'cancelRequested':state.get('cancel:'+request['jobId'],False),'stages':{s:state.get('orchestrator:'+request['jobId']+':'+s) for s in ('before','copy','after')}}
dc,workspace=client(request['credentials'])
result['existingVerifier']=lookup_destination_verifier(dc,request['volume'])
try:
 from destination_verifier_app import create_verifier_app
 create_verifier_app(request['volume'])
 result['factory']='definition_ok_no_cloud'
except Exception as e:
 result['factoryErrorClass']=type(e).__name__
 result['factoryFrames']=[{'file':pathlib.Path(f.filename).name,'line':f.lineno} for f in traceback.extract_tb(e.__traceback__)[-5:]]
print(json.dumps(result))
`;
 const child=spawnSync(process.env.ENGINE_PYTHON,['-c',code],{input:JSON.stringify(input)+'\n',encoding:'utf8',timeout:90000,env:{...process.env},maxBuffer:200000,windowsHide:true});
 let result;try{result=JSON.parse(child.stdout.trim());}catch{throw Error('READONLY_DIAGNOSTIC_FAILED_NO_RAW_OUTPUT');}
 console.log(JSON.stringify({jobId:job.id,status:job.status,cloudStopped:job.cloudStopped,elapsedSeconds:job.elapsedSeconds,estimatedUSD:job.estimatedUSD,diagnostic:result}));
}finally{await store.close();}
