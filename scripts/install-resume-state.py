"""Apply only the approved resume-state fix; no GPU/provider calls or admin asset replacement."""
import hashlib,json,os,pathlib,subprocess,urllib.request
COMMIT='2721859ed844d07908db29ced6a064c05ce532e9'
NAME='services/film-engine/engine/film-platform.mjs'
BASE='https://raw.githubusercontent.com/Basmali12/mashhad-ad-studio/'+COMMIT+'/'
def fetch(name):
 with urllib.request.urlopen(BASE+name,timeout=30) as r:return r.read(4194304)
def digest(b):return hashlib.sha256(b.replace(b'\r\n',b'\n')).hexdigest()
def run(args):return subprocess.run(args,check=True,capture_output=True,text=True,timeout=45).stdout.strip()
def main():
 assert os.geteuid()==0
 m=json.loads(fetch('scripts/account-setup-release.json'))['sources'][NAME]
 p=pathlib.Path('/srv/iraq-ai-studio-staging/current')/NAME;old=p.read_bytes()
 if digest(old)==m['after']:print(json.dumps({'installed':True,'alreadyApplied':True,'gpuJobsStarted':0}));return
 assert digest(old)==m['before'],'SOURCE_CHANGED'
 new=fetch(NAME);assert digest(new)==m['after'],'SOURCE_HASH'
 env=dict(l.split('=',1) for l in pathlib.Path('/etc/iraq-ai-film-platform-staging/film.env').read_text().splitlines() if '=' in l and not l.startswith('#'))
 query="select count(*) from iff_records where (kind='film-image-preview' and data->>'status' in ('queued','running')) or (kind='job' and coalesce(data->>'cloudStopped','false')!='true' and data->>'action' in ('start','generate','prepare')) or (kind='rental' and data->>'state'!='closed') or (kind='text-call' and data->>'status' in ('queued','running')) or (kind='film-project' and coalesce(data->>'textPending','false') not in ('false','null',''))"
 def idle():assert run(['runuser','-u','postgres','--','psql','-d',env['ENGINE_DATABASE_NAME'],'-Atc',query])=='0','ACTIVE_WORK_NO_RESTART'
 idle();backup=pathlib.Path('/root/codex-resume-state-before-2721859.mjs')
 if not backup.exists():backup.write_bytes(old);backup.chmod(0o600)
 assert digest(backup.read_bytes())==m['before'],'BACKUP_CHANGED'
 tmp=p.with_name('film-platform.resume-candidate.mjs');tmp.write_bytes(new);tmp.chmod(0o644)
 run(['/opt/node-v24.14.1-linux-x64/bin/node','--check',str(tmp)]);idle();os.replace(tmp,p)
 try:
  run(['systemctl','restart','iraq-ai-film-platform-staging']);assert run(['systemctl','is-active','iraq-ai-film-platform-staging'])=='active'
 except Exception:
  p.write_bytes(old);run(['systemctl','restart','iraq-ai-film-platform-staging']);raise
 print(json.dumps({'installed':True,'activeWorkBeforeRestart':0,'gpuJobsStarted':0,'backup':str(backup)}))
if __name__=='__main__':main()
