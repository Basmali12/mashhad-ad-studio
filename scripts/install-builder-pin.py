"""Idle-only provider fix; no SDK calls, model transfers or cloud retries."""
import hashlib,json,os,pathlib,re,subprocess,sys,time,urllib.request
NAME='services/film-engine/engine/provider.mjs'
BASE='https://raw.githubusercontent.com/Basmali12/mashhad-ad-studio/'

def sha(b):return hashlib.sha256(b.replace(b'\r\n',b'\n')).hexdigest()
def run(args):return subprocess.run(args,check=True,capture_output=True,text=True,timeout=45).stdout.strip()
def get(url):
 with urllib.request.urlopen(url,timeout=30) as r:return r.read(4194304)

def main():
 assert os.geteuid()==0
 commit=sys.argv[1];assert re.fullmatch('[a-f0-9]{40}',commit)
 m=json.loads(get(BASE+commit+'/scripts/builder-pin-release.json'))
 env=dict(l.split('=',1) for l in pathlib.Path('/etc/iraq-ai-film-platform-staging/film.env').read_text().splitlines() if '=' in l and not l.startswith('#'))
 query="select count(*) from iff_records where (kind='film-image-preview' and data->>'status' in ('queued','running')) or (kind='job' and coalesce(data->>'cloudStopped','false')!='true' and data->>'action' in ('start','generate','prepare')) or (kind='rental' and data->>'state'!='closed') or (kind='text-call' and data->>'status' in ('queued','running')) or (kind='film-project' and coalesce(data->>'textPending','false') not in ('false','null',''))"
 def idle():assert run(['runuser','-u','postgres','--','psql','-d',env['ENGINE_DATABASE_NAME'],'-Atc',query])=='0','ACTIVE_WORK_NO_RESTART'
 idle();p=pathlib.Path('/srv/iraq-ai-studio-staging/current')/NAME;old=p.read_bytes()
 assert sha(old)==m['before'],'SOURCE_CHANGED'
 new=get(BASE+commit+'/'+NAME);assert sha(new)==m['after'],'SOURCE_HASH'
 backup=pathlib.Path('/root/codex-builder-pin-before-'+commit[:12]);assert not backup.exists(),'BACKUP_EXISTS'
 backup.write_bytes(old);backup.chmod(0o600)
 tmp=p.with_name('provider.builder-candidate.mjs');tmp.write_bytes(new);tmp.chmod(0o644)
 run(['/opt/node-v24.14.1-linux-x64/bin/node','--check',str(tmp)]);idle();os.replace(tmp,p)
 try:
  run(['systemctl','restart','iraq-ai-film-platform-staging'])
  time.sleep(2)
  assert run(['systemctl','is-active','iraq-ai-film-platform-staging'])=='active','SERVICE_NOT_ACTIVE'
  assert json.loads(get('http://127.0.0.1:3480/health')).get('status')=='ok','HEALTH_FAILED'
 except Exception:
  p.write_bytes(old);run(['systemctl','restart','iraq-ai-film-platform-staging']);raise
 print(json.dumps({'installed':True,'builderPin':'2025.06','activeWorkBeforeRestart':0,'backup':str(backup),'gpuJobsStarted':0,'modelTransfers':0}))
if __name__=='__main__':main()
