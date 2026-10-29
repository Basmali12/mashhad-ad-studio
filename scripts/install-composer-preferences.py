"""Account orientation preferences and explicit discussion direction; no provider calls on deployment."""
import hashlib,json,os,pathlib,re,shutil,subprocess,sys,urllib.request
BASE_HASHES={'services/film-engine/engine/film-platform.mjs': '4fc9cc4d7e7b21d26ec642fb596e6822971b0fee55937848de4b9f39df85b052', 'services/film-engine/engine/openai-director.mjs': '7ff3edc8d81581e3df4937f92ecf4f50ef8c9ca0a11558ee5dfcb216e1a151d6', 'services/film-engine/engine/film-contracts.ts': '411ff0e8aedc9eeb3d23cadb323a298ed6387fd9a79efbaec9376b5782948f38', 'services/film-gateway/film-bridge.mjs': 'da36c6a5d61dbc32e17b1efc2f62fbaf5edc0be2b16edd350660b8de4df46c70', 'shared/film-contracts.ts': '411ff0e8aedc9eeb3d23cadb323a298ed6387fd9a79efbaec9376b5782948f38', 'services/film-engine/engine/film-orientation.mjs': None}
NEW_HASHES={'services/film-engine/engine/film-platform.mjs': '461901f4a7b37d4f3442a3e91e329d1cb13245c46835282ae715ae4f556b49cc', 'services/film-engine/engine/openai-director.mjs': '268e446c24f84620d3fed8e969c04b1d17d3ed2387a3d6592c5b19b869a40a6e', 'services/film-engine/engine/film-contracts.ts': 'e914a80391f6a5edb6d7650d30dad132751946c67f22d1901581a5e251e9cf6b', 'services/film-gateway/film-bridge.mjs': 'e7460a2fc4d3330901e1a740fe47ec1510ede35b197918201263be98e41af857', 'shared/film-contracts.ts': 'e914a80391f6a5edb6d7650d30dad132751946c67f22d1901581a5e251e9cf6b', 'services/film-engine/engine/film-orientation.mjs': '4ac5ab173b081be2c9e8e9e05210fe16104339eca28747005616530dc1284eaa'}

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
 backup=pathlib.Path('/root/codex-composer-before-20261030');backup.mkdir(mode=0o700)
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
 print(json.dumps({'installed':True,'newGPUJobs':0,'catalogChangedByInstaller':False,'modelTransfers':0,'note':'Orientation preference and discussion policy only; no paid calls during deployment.'}))
if __name__=='__main__':main()
