"""Recoverable connection errors and persistent conversation actions; no provider calls on deployment."""
import hashlib,json,os,pathlib,re,shutil,subprocess,sys,urllib.request
BASE_HASHES={'services/film-engine/engine/film-platform.mjs': 'b4c11587fe54ff1609a192ea7c29b2160989ad089ea75e19133e562496aa1f0c', 'services/film-engine/engine/film-contracts.ts': '5884060048dd0d1c7a76d354c951fe351aca102c78c9505f55cd8d1026ac228c', 'services/film-gateway/film-bridge.mjs': '839d362fd8fcfcd8ac4cea98087f17ad56e27c6e8e56c15b80a5742aba84d945', 'shared/film-contracts.ts': '5884060048dd0d1c7a76d354c951fe351aca102c78c9505f55cd8d1026ac228c', 'shared/film-request-policy.ts': None}
NEW_HASHES={'services/film-engine/engine/film-platform.mjs': '4fc9cc4d7e7b21d26ec642fb596e6822971b0fee55937848de4b9f39df85b052', 'services/film-engine/engine/film-contracts.ts': '411ff0e8aedc9eeb3d23cadb323a298ed6387fd9a79efbaec9376b5782948f38', 'services/film-gateway/film-bridge.mjs': 'da36c6a5d61dbc32e17b1efc2f62fbaf5edc0be2b16edd350660b8de4df46c70', 'shared/film-contracts.ts': '411ff0e8aedc9eeb3d23cadb323a298ed6387fd9a79efbaec9376b5782948f38', 'shared/film-request-policy.ts': '75d88493e45fcf51da68467bfb976dc394df859f2a4ef5bbeb6eee7baaa04b71'}

def sha(data):return hashlib.sha256(data.replace(b'\r\n',b'\n')).hexdigest()
def run(args):return subprocess.run(args,capture_output=True,text=True,check=True,timeout=45)
def main():
 assert os.geteuid()==0
 commit=sys.argv[1];assert re.fullmatch('[a-f0-9]{40}',commit)
 env=dict(l.split('=',1) for l in pathlib.Path('/etc/iraq-ai-film-platform-staging/film.env').read_text().splitlines() if '=' in l and not l.startswith('#'))
 q="select count(*) from iff_records where (kind='film-image-preview' and data->>'status' in ('queued','running')) or (kind='job' and coalesce(data->>'cloudStopped','false')!='true' and data->>'action' in ('start','generate','prepare')) or (kind='rental' and data->>'state'!='closed') or (kind='text-call' and data->>'status' in ('queued','running')) or (kind='film-project' and coalesce(data->>'textPending','false') not in ('false','null',''))"
 assert run(['runuser','-u','postgres','--','psql','-d',env['ENGINE_DATABASE_NAME'],'-Atc',q]).stdout.strip()=='0','ACTIVE_WORK_NO_RESTART'
 targets={name:pathlib.Path('/srv/iraq-ai-studio-staging/current')/name if name.startswith('services/film-engine/') else pathlib.Path('/srv/mashhad-film/current')/name for name in NEW_HASHES}
 for name,digest in BASE_HASHES.items():
  if digest is None:assert not targets[name].exists(),'UNREVIEWED_EXISTING_FILE'
  else:assert sha(targets[name].read_bytes())==digest,'UNREVIEWED_SERVER_SOURCE'
 payload={}
 for name,digest in NEW_HASHES.items():
  b=urllib.request.urlopen('https://raw.githubusercontent.com/Basmali12/mashhad-ad-studio/'+commit+'/'+name,timeout=25).read();assert sha(b)==digest;payload[name]=b
 backup=pathlib.Path('/root/codex-history-before-20261030');backup.mkdir(mode=0o700)
 for name,target in targets.items():
  if target.exists():shutil.copy2(target,backup/(name.replace('/','-')))
 try:
  for name,b in payload.items():
   target=targets[name];candidate=target.with_name(target.name+'.trial-candidate');candidate.write_bytes(b);candidate.chmod(0o644);os.replace(candidate,target)
   if target.suffix=='.mjs':run(['/opt/node-v24.14.1-linux-x64/bin/node','--check',str(target)])
  for unit in ['iraq-ai-film-platform-staging','mashhad-film-gateway']:run(['systemctl','restart',unit]);assert run(['systemctl','is-active',unit]).stdout.strip()=='active'
 except Exception:
  for name,target in targets.items():
   saved=backup/name.replace('/','-')
   if saved.exists():shutil.copy2(saved,target)
   elif BASE_HASHES[name] is None:target.unlink(missing_ok=True)
  for unit in ['iraq-ai-film-platform-staging','mashhad-film-gateway']:run(['systemctl','restart',unit])
  raise
 print(json.dumps({'installed':True,'newGPUJobs':0,'catalogChangedByInstaller':False,'modelTransfers':0,'note':'Conversation metadata and read-error recovery only; no paid calls during deployment.'}))
if __name__=='__main__':main()
