"""Local root read-only account/rental metadata; never prints credentials."""
import pathlib,subprocess,json,os
def main():
 assert os.geteuid()==0
 result={}
 for unit,envfile,legacy in [('iraqi-film-forge','/etc/iraqi-film-forge/app.env',True),('iraq-ai-film-platform-staging','/etc/iraq-ai-film-platform-staging/film.env',False)]:
  pid=subprocess.check_output(['systemctl','show','-p','MainPID','--value',unit],text=True).strip();assert pid!='0'
  cwd=pathlib.Path('/proc/'+pid+'/cwd').resolve()
  env=dict(x.decode().split('=',1) for x in pathlib.Path('/proc/'+pid+'/environ').read_bytes().split(b'\0') if b'=' in x)
  for line in pathlib.Path(envfile).read_text().splitlines():
   if line and not line.startswith('#') and '=' in line:
    k,v=line.split('=',1);env[k]=v.strip().strip('"').strip("'")
  env['ROUTING_INSPECT_LEGACY']='YES' if legacy else 'NO'
  code="""import fs from 'node:fs';import path from 'node:path';import {openStore} from './engine/open-store.mjs';
const legacy=process.env.ROUTING_INSPECT_LEGACY==='YES',folder=path.resolve(process.env.FILM_DATA_DIR||process.env.ENGINE_DATA_DIR||'.engine-data');
if(!fs.existsSync(folder))throw Error('MISSING_DATA_FOLDER');
if(legacy&&process.env.ENGINE_DATABASE_DRIVER!=='postgres'&&!fs.existsSync(path.join(folder,'engines.sqlite')))throw Error('MISSING_DATABASE');
const key=legacy?(await import('./engine/keyring.mjs')).masterKey(folder):process.env.ENGINE_MASTER_KEY;
const store=await openStore(folder,key);if(!store)throw Error('VAULT_NOT_CONFIGURED');
try{const accounts=await store.all('account');console.log(JSON.stringify({accounts:accounts.map(a=>({id:a.id,workspace:a.workspace,label:a.label,volume:a.volume,activated:a.activated,credentialsPresent:!!a.credentials,ready:a.discovery?.ready,checkedAt:a.discovery?.checkedAt,productionReady:a.discovery?.productionQuality?.ready})),slots:(await store.all('film-slot')).map(s=>({id:s.id,accountId:s.accountId,name:s.name,published:s.published,locked:s.locked})),activeJobs:(await store.all('job')).filter(j=>['start','generate','prepare'].includes(j.action)&&j.cloudStopped!==true).map(j=>({id:j.id,accountId:j.accountId,status:j.status})),rentals:(await store.all('rental')).map(r=>({id:r.id,accountId:r.accountId,slotId:r.engineSlotId,state:r.state,stopReason:r.stopReason,engineJobId:r.engineJobId}))}));}finally{await store.close();}"""
  run=subprocess.run(['/opt/node-v24.14.1-linux-x64/bin/node','--input-type=module','-e',code],cwd=cwd,env=env,capture_output=True,text=True,timeout=40)
  result[unit]={'exit':run.returncode,'metadata':json.loads(run.stdout) if run.returncode==0 else None,'diagnosticBytes':len(run.stderr)}
 print(json.dumps(result))
if __name__=='__main__':main()
