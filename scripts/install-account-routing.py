"""Account-isolated routing maintenance; no GPU, model transfers, or financial edits."""
import hashlib,json,os,pathlib,re,shutil,subprocess,sys,urllib.request
BASE_HASHES={'services/film-engine/engine/api.mjs': '4e3f2bff1f3c17e7bfe9c8178809a025ab1b4c829f0ab40772239880b411d35f', 'services/film-engine/engine/film-platform.mjs': 'cfa7f4c351c34496a9da0bb96b353d1f58288e2fcafdb056ad671ba8f69eb862', 'services/film-engine/engine/account-routing.mjs': None, 'services/film-engine/engine/film-contracts.ts': 'b412338bcf67bff0fa8843f8c57ec856428e1a4672aebd96bb52db979fa6f1c1', 'services/film-gateway/film-bridge.mjs': 'aab9a871e0097ba7f14e17e89782a413a6d853acea109237ebefdc9525f178d2', 'shared/film-contracts.ts': 'b412338bcf67bff0fa8843f8c57ec856428e1a4672aebd96bb52db979fa6f1c1'}
NEW_HASHES={'services/film-engine/engine/api.mjs': 'ce8f6a26852321a345bafcc7c88185c56b816a84369714c1842201430ca34143', 'services/film-engine/engine/film-platform.mjs': '2ae6c758680e7e87a5bde4f3dfabb142783fe23c83be10e421addb79413b124d', 'services/film-engine/engine/account-routing.mjs': '77973887e61a4a6c96e3aeee65fd7d1771d2b41254589ea682d06c002d284649', 'services/film-engine/engine/film-contracts.ts': 'bafbd35ebd10f31cbbcbaba7e701db751192a10ee28bd69fe7ce7e998e0611e9', 'services/film-gateway/film-bridge.mjs': 'b041d3bcc0035772467c1094a90f7d5efe859f7c51d9725699f80689855903b2', 'shared/film-contracts.ts': 'bafbd35ebd10f31cbbcbaba7e701db751192a10ee28bd69fe7ce7e998e0611e9'}

def sha(data):return hashlib.sha256(data.replace(b'\r\n',b'\n')).hexdigest()
def run(args):return subprocess.run(args,capture_output=True,text=True,check=True,timeout=45)
def main():
 assert os.geteuid()==0
 commit=sys.argv[1];assert re.fullmatch('[a-f0-9]{40}',commit)
 env=dict(l.split('=',1) for l in pathlib.Path('/etc/iraq-ai-film-platform-staging/film.env').read_text().splitlines() if '=' in l and not l.startswith('#'))
 q="select count(*) from iff_records where (kind='job' and coalesce(data->>'cloudStopped','false')!='true' and data->>'action' in ('start','generate','prepare')) or (kind='rental' and data->>'state'!='closed')"
 assert run(['runuser','-u','postgres','--','psql','-d',env['ENGINE_DATABASE_NAME'],'-Atc',q]).stdout.strip()=='0','ACTIVE_WORK_NO_RESTART'
 targets={name:pathlib.Path('/srv/iraq-ai-studio-staging/current')/name if name.startswith('services/film-engine/') else pathlib.Path('/srv/mashhad-film/current')/name for name in NEW_HASHES}
 for name,digest in BASE_HASHES.items():
  if digest is None:assert not targets[name].exists(),'UNREVIEWED_EXISTING_FILE'
  else:assert sha(targets[name].read_bytes())==digest,'UNREVIEWED_SERVER_SOURCE'
 payload={}
 for name,digest in NEW_HASHES.items():
  b=urllib.request.urlopen('https://raw.githubusercontent.com/Basmali12/mashhad-ad-studio/'+commit+'/'+name,timeout=25).read();assert sha(b)==digest;payload[name]=b
 backup=pathlib.Path('/root/codex-account-routing-before-20261029');backup.mkdir(mode=0o700)
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
 print(json.dumps({'installed':True,'newGPUJobs':0,'catalogChangedByInstaller':False,'modelTransfers':0,'note':'Account reassignment must use the administrator operation; historical rentals remain unchanged.'}))
if __name__=='__main__':main()
