"""Owner-authorized reuse of the existing backup link on this same host. No GPU/transfer.
Plaintext credentials travel only in private process pipes/environment, never disk/logs.
"""
import pathlib,subprocess,json,os
NODE='/opt/node-v24.14.1-linux-x64/bin/node'
def context(unit,envfile):
 pid=subprocess.check_output(['systemctl','show','-p','MainPID','--value',unit],text=True).strip();assert pid!='0'
 cwd=pathlib.Path('/proc/'+pid+'/cwd').resolve()
 env=dict(x.decode().split('=',1) for x in pathlib.Path('/proc/'+pid+'/environ').read_bytes().split(b'\0') if b'=' in x)
 for line in pathlib.Path(envfile).read_text().splitlines():
  if line and not line.startswith('#') and '=' in line:
   k,v=line.split('=',1);env[k]=v.strip().strip('"').strip("'")
 return cwd,env

def main():
 assert os.geteuid()==0
 oldcwd,oldenv=context('iraqi-film-forge','/etc/iraqi-film-forge/app.env')
 newcwd,newenv=context('iraq-ai-film-platform-staging','/etc/iraq-ai-film-platform-staging/film.env')
 export="""import path from 'node:path';import {openStore} from './engine/open-store.mjs';import {masterKey} from './engine/keyring.mjs';
const folder=path.resolve(process.env.FILM_DATA_DIR||process.env.ENGINE_DATA_DIR||'.engine-data'),store=await openStore(folder,masterKey(folder));
try{const a=(await store.all('account')).find(a=>a.workspace==='husrd2021');if(!a||a.mode!=='token'||!a.credentials)throw Error('BACKUP_LINK_NOT_FOUND');
console.log(JSON.stringify({id:a.id,workspace:a.workspace,volume:a.volume,credentials:store.open(a.credentials,a.id)}));}finally{await store.close();}"""
 first=subprocess.run([NODE,'--input-type=module','-e',export],cwd=oldcwd,env=oldenv,capture_output=True,text=True,timeout=40)
 if first.returncode:print(json.dumps({'imported':False,'error':'SOURCE_LINK_UNAVAILABLE'}));return
 payload=json.loads(first.stdout);assert payload['workspace']=='husrd2021' and payload['volume']=='iff-ltx25-d1eb68a8'
 install="""import fs from 'node:fs';import path from 'node:path';import {openStore} from './engine/open-store.mjs';import {ModalProvider} from './engine/provider.mjs';import {inferenceManifest} from './engine/config.mjs';
let raw='';for await(const chunk of process.stdin)raw+=chunk;const incoming=JSON.parse(raw);raw='';
const folder=path.resolve(process.env.FILM_DATA_DIR||process.env.ENGINE_DATA_DIR),store=await openStore(folder,process.env.ENGINE_MASTER_KEY),provider=new ModalProvider();
try{
 if((await store.all('job')).some(j=>['start','generate','prepare'].includes(j.action)&&j.cloudStopped!==true)||(await store.all('rental')).some(r=>r.state!=='closed'))throw Error('ACTIVE_WORK');
 const existing=(await store.all('account')).find(a=>a.workspace===incoming.workspace);if(existing&&existing.id!==incoming.id)throw Error('EXISTING_BACKUP_REQUIRES_REVIEW');
 const credentials={tokenId:incoming.credentials.tokenId,tokenSecret:incoming.credentials.tokenSecret,expectedWorkspace:incoming.workspace};
 const verified=await provider.call('verify',{credentials});if(verified.workspace!==incoming.workspace)throw Error('WORKSPACE_MISMATCH');
 const base=await provider.call('discover',{credentials,volume:incoming.volume}),production=await provider.call('quality_discover',{credentials,volume:incoming.volume});
 const ready=production.ready===true&&production.profile===inferenceManifest.id&&Object.entries(inferenceManifest.files).every(([name,s])=>production.files?.some(f=>f.name===name&&f.present===true&&f.size===s.size));
 const a={...existing,id:incoming.id,label:'husrd2021',workspace:incoming.workspace,mode:'token',role:'backup',volume:incoming.volume,createdAt:existing?.createdAt||Date.now(),activated:ready,credentials:store.seal({tokenId:credentials.tokenId,tokenSecret:credentials.tokenSecret},incoming.id),discovery:{...base,baseReady:base.ready,productionQuality:production,ready,checkedAt:Date.now()}};
 await store.transaction(async()=>{if((await store.all('job')).some(j=>['start','generate','prepare'].includes(j.action)&&j.cloudStopped!==true)||(await store.all('rental')).some(r=>r.state!=='closed'))throw Error('ACTIVE_WORK');await store.put('account',a);await store.audit('existing_backup_link_resealed',a.id);});
 console.log(JSON.stringify({imported:true,workspace:a.workspace,accountId:a.id,volume:a.volume,ready,files:production.files?.map(f=>({name:f.name,size:f.size,present:f.present})),newGPUJobs:0,transferredBytes:0}));
}finally{await store.close();}"""
 second=subprocess.run([NODE,'--input-type=module','-e',install],input=json.dumps(payload),cwd=newcwd,env=newenv,capture_output=True,text=True,timeout=250)
 if second.returncode:print(json.dumps({'imported':False,'error':'BACKUP_VERIFY_OR_IMPORT_FAILED','diagnosticBytes':len(second.stderr)}));return
 print(json.dumps(json.loads(second.stdout)))
if __name__=='__main__':
 try:main()
 except Exception:print(json.dumps({'imported':False,'error':'SAFE_IMPORT_STOPPED_NO_RETRY'}))
