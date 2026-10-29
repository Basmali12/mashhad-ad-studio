"""Customer media retention deployment; no GPU, model transfers, or financial edits."""
import hashlib,json,os,pathlib,re,shutil,subprocess,sys,urllib.request
BASE_HASHES={'services/film-engine/engine/film-platform.mjs': 'df926cb37f4deee33bc832eacde12438b27361dcb7364cee88313966b53c1abb', 'services/film-engine/engine/film-media-library.mjs': None, 'services/film-engine/engine/film-contracts.ts': 'b81b1692d1bcfe79f9b0b766f5470f36af549e1de72c460a30abf813b3165151', 'services/film-gateway/film-bridge.mjs': 'cc4c412099d8efe1958a00192a9f8b682d357edbd5cffb74f22fbe5b120b9618', 'shared/film-contracts.ts': 'b81b1692d1bcfe79f9b0b766f5470f36af549e1de72c460a30abf813b3165151'}
NEW_HASHES={'services/film-engine/engine/film-platform.mjs': '4fa368579e6d12ab092e32cc06d3e81a8d6d38e885b69e5adca0f9e5878508cd', 'services/film-engine/engine/film-media-library.mjs': 'f992e58f48df70247174db2e319536e2eb3740a60e4df164c70d8e74775db355', 'services/film-engine/engine/film-contracts.ts': '35a1fcc13b0288faabe7a45a550da3181d324f2acbae0f05da7c44f909c711c6', 'services/film-gateway/film-bridge.mjs': '7b7fe32a2857c91c72fabd30dd98971d63db22d15db7e68c187e7722abb30d49', 'shared/film-contracts.ts': '35a1fcc13b0288faabe7a45a550da3181d324f2acbae0f05da7c44f909c711c6'}

def sha(data):return hashlib.sha256(data.replace(b'\r\n',b'\n')).hexdigest()
def run(args):return subprocess.run(args,capture_output=True,text=True,check=True,timeout=45)
def main():
 assert os.geteuid()==0
 commit=sys.argv[1];assert re.fullmatch('[a-f0-9]{40}',commit)
 env=dict(l.split('=',1) for l in pathlib.Path('/etc/iraq-ai-film-platform-staging/film.env').read_text().splitlines() if '=' in l and not l.startswith('#'))
 q="select count(*) from iff_records where (kind='job' and coalesce(data->>'cloudStopped','false')!='true' and data->>'action' in ('start','generate','prepare')) or (kind='rental' and data->>'state'!='closed') or (kind='text-call' and data->>'status' in ('queued','running')) or (kind='film-project' and coalesce(data->>'textPending','false') not in ('false','null',''))"
 assert run(['runuser','-u','postgres','--','psql','-d',env['ENGINE_DATABASE_NAME'],'-Atc',q]).stdout.strip()=='0','ACTIVE_WORK_NO_RESTART'
 targets={name:pathlib.Path('/srv/iraq-ai-studio-staging/current')/name if name.startswith('services/film-engine/') else pathlib.Path('/srv/mashhad-film/current')/name for name in NEW_HASHES}
 for name,digest in BASE_HASHES.items():
  if digest is None:assert not targets[name].exists(),'UNREVIEWED_EXISTING_FILE'
  else:assert sha(targets[name].read_bytes())==digest,'UNREVIEWED_SERVER_SOURCE'
 payload={}
 for name,digest in NEW_HASHES.items():
  b=urllib.request.urlopen('https://raw.githubusercontent.com/Basmali12/mashhad-ad-studio/'+commit+'/'+name,timeout=25).read();assert sha(b)==digest;payload[name]=b
 backup=pathlib.Path('/root/codex-media-library-before-20261029');backup.mkdir(mode=0o700)
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
 print(json.dumps({'installed':True,'newGPUJobs':0,'catalogChangedByInstaller':False,'modelTransfers':0,'note':'Seven-day customer artifact retention; financial receipts and model files retained.'}))
if __name__=='__main__':main()
