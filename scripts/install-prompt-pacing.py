"""Hash-pinned, idle-only engine maintenance. Default is read-only preflight."""
import hashlib,json,os,pathlib,re,shutil,socket,subprocess,sys,time,urllib.request

def digest(data):return hashlib.sha256(data.replace(b'\r\n',b'\n')).hexdigest()
def run(args):return subprocess.run(args,check=True,capture_output=True,text=True,timeout=60).stdout.strip()
def get(url):
 with urllib.request.urlopen(url,timeout=30) as response:return response.read(4194304)

def main():
 assert os.geteuid()==0 and socket.gethostname()=='muhtaj-app','WRONG_SERVER'
 release=sys.argv[1];assert re.fullmatch('[a-f0-9]{40}',release)
 raw='https://raw.githubusercontent.com/Basmali12/mashhad-ad-studio/'
 manifest=json.loads(get(raw+release+'/scripts/prompt-pacing-release.json'))
 base=pathlib.Path('/srv/iraq-ai-studio-staging/current').resolve()
 engine=base/'services/film-engine/engine'
 env=dict(line.split('=',1) for line in pathlib.Path('/etc/iraq-ai-film-platform-staging/film.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
 query="select count(*) from iff_records where (kind='job' and coalesce(data->>'cloudStopped','false')!='true' and data->>'action' in ('start','generate','prepare')) or (kind='rental' and data->>'state'!='closed') or (kind='text-call' and data->>'status' in ('queued','running')) or (kind='film-image-preview' and data->>'status' in ('queued','running')) or (kind='film-project' and coalesce(data->>'textPending','false') not in ('false','null',''))"
 def idle():assert run(['runuser','-u','postgres','--','psql','-d',env['ENGINE_DATABASE_NAME'],'-Atc',query])=='0','ACTIVE_WORK_NO_RESTART'
 idle();payload={};before={}
 for row in manifest['files']:
  name=row['name'];assert re.fullmatch('[a-z-]+\.(mjs|cjs)',name)
  target=engine/name;assert not target.is_symlink()
  old=target.read_bytes() if target.exists() else None
  assert (digest(old) if old is not None else None)==row['before'],'SERVER_SOURCE_CHANGED_'+name
  data=get(raw+manifest['sourceCommit']+'/services/film-engine/engine/'+name)
  assert digest(data)==row['after'],'SOURCE_HASH_'+name
  payload[name]=data;before[name]=old
 print(json.dumps({'preflight':True,'files':len(payload),'activeWork':0,'gpuStarted':False}),flush=True)
 if '--apply' not in sys.argv:return
 backup=pathlib.Path('/root/codex-prompt-pacing-before-'+release[:12]);assert not backup.exists(),'BACKUP_EXISTS_INSPECT_NO_REPLAY'
 backup.mkdir(mode=0o700)
 for name,old in before.items():
  if old is not None:(backup/name).write_bytes(old)
 (backup/'manifest.json').write_text(json.dumps(manifest))
 node='/opt/node-v24.14.1-linux-x64/bin/node'
 for name,data in payload.items():
  candidate=backup/name.replace('.','-candidate.',1);candidate.write_bytes(data)
  run([node,'--check',str(candidate)])
 idle();changed=[]
 try:
  for name,data in payload.items():
   target=engine/name;candidate=target.with_name(name+'.release-candidate');candidate.write_bytes(data);candidate.chmod(0o644);os.replace(candidate,target);changed.append(name)
  run(['systemctl','restart','iraq-ai-film-platform-staging']);time.sleep(2)
  assert run(['systemctl','is-active','iraq-ai-film-platform-staging'])=='active','SERVICE_NOT_ACTIVE'
  assert json.loads(get('http://127.0.0.1:3480/health')).get('status')=='ok','HEALTH_FAILED'
  for name,data in payload.items():assert digest((engine/name).read_bytes())==digest(data),'POST_INSTALL_HASH'
 except Exception:
  for name in changed:
   if before[name] is None:(engine/name).unlink(missing_ok=True)
   else:(engine/name).write_bytes(before[name])
  run(['systemctl','restart','iraq-ai-film-platform-staging']);raise
 print(json.dumps({'installed':True,'sourceCommit':manifest['sourceCommit'],'files':len(payload),'backup':str(backup),'healthy':True,'gpuStarted':False,'modelTransfers':0,'databaseMigrations':0}),flush=True)

if __name__=='__main__':
 try:main()
 except Exception as error:
  code=str(error) if isinstance(error,AssertionError) else type(error).__name__
  print(json.dumps({'installed':False,'error':code if re.fullmatch('[A-Za-z0-9_.-]{1,150}',code) else type(error).__name__,'secretsPrinted':False}));sys.exit(1)
