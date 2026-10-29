"""Chat image bridge correction; no GPU, model transfers, or paid writer calls."""
import hashlib,json,os,pathlib,re,shutil,subprocess,sys,urllib.request
BASE_HASHES={'services/film-engine/engine/film-platform.mjs': '4fa368579e6d12ab092e32cc06d3e81a8d6d38e885b69e5adca0f9e5878508cd', 'services/film-engine/engine/openai-director.mjs': '2cf8cc061e81d8dd875efca4b8be05d6ded6d9be53187d22ff31c3f8dae1f32f', 'services/film-engine/engine/film-contracts.ts': '35a1fcc13b0288faabe7a45a550da3181d324f2acbae0f05da7c44f909c711c6', 'services/film-gateway/film-bridge.mjs': '7b7fe32a2857c91c72fabd30dd98971d63db22d15db7e68c187e7722abb30d49', 'shared/film-contracts.ts': '35a1fcc13b0288faabe7a45a550da3181d324f2acbae0f05da7c44f909c711c6'}
NEW_HASHES={'services/film-engine/engine/film-platform.mjs': '6dce10d77e1838ba7098d1d81e7a5cb85f0421ae812cb824c1bbeef86ada2b39', 'services/film-engine/engine/openai-director.mjs': 'e6bafffe9eabd7537fb949db025151da665a0373fcf0ee4534f4b9119a49a83c', 'services/film-engine/engine/film-contracts.ts': 'a4bbad1f06d4f316c07c423302f5b4cf62bfbfb9aabf4c96347c701c9ea4ebe2', 'services/film-gateway/film-bridge.mjs': '3ad5cb7df0738dac680ebe9fa44216cf3765099d147451f58b99fab6aa1bd55b', 'shared/film-contracts.ts': 'a4bbad1f06d4f316c07c423302f5b4cf62bfbfb9aabf4c96347c701c9ea4ebe2'}

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
 backup=pathlib.Path('/root/codex-chat-images-before-20261030');backup.mkdir(mode=0o700)
 for name,target in targets.items():
  if target.exists():shutil.copy2(target,backup/(name.replace('/','-')))
 gateway_env=pathlib.Path('/etc/mashhad-film/gateway.env');env_backup=backup/'gateway.env';shutil.copy2(gateway_env,env_backup);env_backup.chmod(0o600)
 try:
  for name,b in payload.items():
   target=targets[name];candidate=target.with_name(target.name+'.trial-candidate');candidate.write_bytes(b);candidate.chmod(0o644);os.replace(candidate,target)
   if target.suffix=='.mjs':run(['/opt/node-v24.14.1-linux-x64/bin/node','--check',str(target)])
  original=gateway_env.read_text();lines=[l for l in original.splitlines() if not l.startswith('FILM_PUBLIC_MEDIA_ORIGIN=')];lines.append('FILM_PUBLIC_MEDIA_ORIGIN=https://studio.iraqaistudio.com');gateway_env.write_text('\n'.join(lines)+'\n')
  for unit in ['iraq-ai-film-platform-staging','mashhad-film-gateway']:run(['systemctl','restart',unit]);assert run(['systemctl','is-active',unit]).stdout.strip()=='active'
 except Exception:
  shutil.copy2(env_backup,gateway_env)
  for name,target in targets.items():
   saved=backup/name.replace('/','-')
   if saved.exists():shutil.copy2(saved,target)
   elif BASE_HASHES[name] is None:target.unlink(missing_ok=True)
  for unit in ['iraq-ai-film-platform-staging','mashhad-film-gateway']:run(['systemctl','restart',unit])
  raise
 print(json.dumps({'installed':True,'newGPUJobs':0,'catalogChangedByInstaller':False,'modelTransfers':0,'note':'Public signed image origin configured separately from private bridge; no paid calls.'}))
if __name__=='__main__':main()
