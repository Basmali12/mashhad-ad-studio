// Inspect only by default. Close only an empty setup with no calls or active tasks.
import fs from 'node:fs';
import process from 'node:process';
import console from 'node:console';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
if(process.getuid?.()!==0)throw Error('ROOT_MAINTENANCE_REQUIRED');
const jobId=process.argv[2];if(!/^[a-f0-9-]{36}$/.test(jobId||''))throw Error('INVALID_JOB');
for(const line of fs.readFileSync('/etc/iraq-ai-film-platform-staging/film.env','utf8').split('\n')){const at=line.indexOf('=');if(at>0&&!line.startsWith('#'))process.env[line.slice(0,at)]=line.slice(at+1).trim();}
const root='/srv/iraq-ai-studio-staging/current/services/film-engine/engine';
const {openStore}=await import(pathToFileURL(root+'/open-store.mjs'));
const {ModalProvider,providerEnvironment}=await import(pathToFileURL(root+'/provider.mjs'));
const store=await openStore(process.env.FILM_DATA_DIR,process.env.ENGINE_MASTER_KEY);
try{
 const job=await store.get('job',jobId);if(!job||job.action!=='prepare'||job.tenantId||job.plan?.transport!=='modal-cpu-cloud')throw Error('TRANSFER_SCOPE_REQUIRED');
 const source=await store.get('account',job.sourceId),dest=await store.get('account',job.accountId);
 if(source?.workspace!=='basm1998ali'||!dest||dest.workspace===source.workspace)throw Error('TRANSFER_SCOPE_REQUIRED');
 const credentials=a=>a.mode==='local_profile'?{mode:'local_profile'}:store.open(a.credentials,a.id);
 const close=process.argv.includes('--close-empty-setup'),input={jobId,source:credentials(source),credentials:credentials(dest),volume:dest.volume,close};
 const code=`import sys,json
from modal_bridge import client
from transfer_contract import *
from modal.client import _Client
from modal_proto import api_pb2
from modal._utils.async_utils import synchronize_api
import modal
async def tasks(credentials):
 c=await _Client.from_env() if credentials.get('mode')=='local_profile' else await _Client.from_credentials(credentials['tokenId'],credentials['tokenSecret'])
 return len((await c._stub.TaskList(api_pb2.TaskListRequest(environment_name='main'))).tasks)
try:
 r=json.loads(sys.stdin.readline());c,w=client(r['source']);d,dw=client(r['credentials'])
 if w!=SOURCE_WORKSPACE or dw==w:raise RuntimeError('TRANSFER_SCOPE_REQUIRED')
 state=modal.Dict.from_name(DICT_NAME,client=c,create_if_missing=False,environment_name='main')
 record=state.get('dispatch:'+r['jobId']);active=state.get('active')
 if record and (record.get('workspace')!=dw or record.get('volume')!=r['volume']):raise RuntimeError('TRANSFER_SCOPE_REQUIRED')
 stages=[name for name in ('before','copy','after') if state.get('orchestrator:'+r['jobId']+':'+name)]
 source_tasks=synchronize_api(tasks)(r['source']);dest_tasks=synchronize_api(tasks)(r['credentials'])
 safe=not stages and not (record or {}).get('verifier') and active in (None,r['jobId']) and source_tasks==0 and dest_tasks==0
 result={'jobId':r['jobId'],'sourceRunningTasks':source_tasks,'destinationRunningTasks':dest_tasks,'stages':stages,'verifierRecorded':bool((record or {}).get('verifier')),'safeToCloseEmptySetup':safe,'closed':False}
 if safe and r.get('close'):
  state.put('cancel:'+r['jobId'],True)
  if record:record['setupCancelled']=True;state.put('dispatch:'+r['jobId'],record)
  if active==r['jobId']:state.pop('active',None)
  result['closed']=True
 print(json.dumps(result))
except BaseException as e:print(json.dumps({'errorClass':type(e).__name__}))
`;
 const provider=new ModalProvider();let output='';
 const child=spawn(provider.python,['-c',code],{cwd:root,env:providerEnvironment(input),stdio:['pipe','pipe','pipe']});child.stdout.on('data',b=>{output+=b;if(output.length>20000)child.kill();});child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(input)+'\n');await new Promise(resolve=>{child.once('close',resolve);child.once('error',resolve);});
 let result;for(const line of output.split('\n'))try{const value=JSON.parse(line);if(value.jobId===jobId)result=value;}catch{/* No raw SDK output. */}
 if(!result)throw Error('INSPECTION_NOT_CONFIRMED');
 console.log(JSON.stringify(result));
 if(close&&result.closed&&result.safeToCloseEmptySetup&&result.sourceRunningTasks===0&&result.destinationRunningTasks===0){
  await store.transaction(async()=>{const latest=await store.get('job',jobId);if(latest.result?.videoVerified)throw Error('VIDEO_RESULT_PRESERVED');latest.status='failed';latest.cloudStopped=true;latest.error='TRANSFER_SETUP_FAILED_BEFORE_MODEL_CALLS';latest.finishedAt=Date.now();latest.stopRequestedAt=Date.now();latest.cleanup={cloud_stopped:true,running_containers:0,tasks:0,emptySetupVerified:true};await store.put('job',latest);await store.audit('empty_transfer_setup_closed',jobId);});
  console.log('EMPTY_SETUP_CLOSED_NO_RETRY_NO_GPU');
 }
}catch(error){console.error(/^[A-Z_]{5,100}$/.test(error.message)?error.message:'TRANSFER_INSPECTION_FAILED');process.exitCode=1;}finally{await store.close();}
