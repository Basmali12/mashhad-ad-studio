"""Final film delivery and separately approved image previews; no generation on deployment."""
import hashlib,json,os,pathlib,re,shutil,subprocess,sys,urllib.request
BASE_HASHES={'services/film-engine/engine/film-platform.mjs': '1d4bbb869575de5821b9556ac8f75c602d2834e351b0ba8ed24f178b8bd14ca6', 'services/film-engine/engine/film-image-preview.mjs': None, 'services/film-engine/engine/film-media-library.mjs': 'f992e58f48df70247174db2e319536e2eb3740a60e4df164c70d8e74775db355', 'services/film-engine/engine/openai-director.mjs': 'e6bafffe9eabd7537fb949db025151da665a0373fcf0ee4534f4b9119a49a83c', 'services/film-engine/engine/film-contracts.ts': '91bf96f0f9da9dbb01dfc9d45a214d19afe4b2f9be37d83ee4df6d19d38f8a24', 'services/film-gateway/film-bridge.mjs': 'e823228076e7aedbc8bdaafec26348b1bc130990aec35f7bfb34dc65afeda0f0', 'shared/film-contracts.ts': '91bf96f0f9da9dbb01dfc9d45a214d19afe4b2f9be37d83ee4df6d19d38f8a24'}
NEW_HASHES={'services/film-engine/engine/film-platform.mjs': 'b4c11587fe54ff1609a192ea7c29b2160989ad089ea75e19133e562496aa1f0c', 'services/film-engine/engine/film-image-preview.mjs': '4f99ba66ff782efba416335ae1297934807548a3a3c040ec42f53e3533cb161b', 'services/film-engine/engine/film-media-library.mjs': 'ea41070cadf13d2bd01cdd2991312ffbd793d7aec7096e0a7f5d7a20f4e2d46c', 'services/film-engine/engine/openai-director.mjs': '7ff3edc8d81581e3df4937f92ecf4f50ef8c9ca0a11558ee5dfcb216e1a151d6', 'services/film-engine/engine/film-contracts.ts': '5884060048dd0d1c7a76d354c951fe351aca102c78c9505f55cd8d1026ac228c', 'services/film-gateway/film-bridge.mjs': '839d362fd8fcfcd8ac4cea98087f17ad56e27c6e8e56c15b80a5742aba84d945', 'shared/film-contracts.ts': '5884060048dd0d1c7a76d354c951fe351aca102c78c9505f55cd8d1026ac228c'}

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
 backup=pathlib.Path('/root/codex-final-film-before-20261030');backup.mkdir(mode=0o700)
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
 print(json.dumps({'installed':True,'newGPUJobs':0,'catalogChangedByInstaller':False,'modelTransfers':0,'note':'Final-only customer video, signed previews, separate image approval; no paid calls during deployment.'}))
if __name__=='__main__':main()
