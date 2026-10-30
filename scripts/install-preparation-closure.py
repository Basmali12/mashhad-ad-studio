"""Consume existing closure proof, then update stale-write guards while idle.
No Modal calls, builds, transfers, credentials, or GPU operations in this installer.
"""
import hashlib,json,os,pathlib,re,subprocess,sys,time,urllib.request,uuid
BASE='https://raw.githubusercontent.com/Basmali12/mashhad-ad-studio/'
JOB='de473f07-a395-48d3-891e-cd7c55f822e3'
ROOT=pathlib.Path('/srv/iraq-ai-studio-staging/current')
def sha(b):return hashlib.sha256(b.replace(b'\r\n',b'\n')).hexdigest()
def run(args):return subprocess.run(args,check=True,capture_output=True,text=True,timeout=45).stdout.strip()
def get(url):
 with urllib.request.urlopen(url,timeout=30) as r:return r.read(4194304)
def main():
 assert os.geteuid()==0
 commit=sys.argv[1];assert re.fullmatch('[a-f0-9]{40}',commit)
 m=json.loads(get(BASE+commit+'/scripts/preparation-closure-release.json'))
 env=dict(l.split('=',1) for l in pathlib.Path('/etc/iraq-ai-film-platform-staging/film.env').read_text().splitlines() if '=' in l and not l.startswith('#'))
 def sql(q):return run(['runuser','-u','postgres','--','psql','-v','ON_ERROR_STOP=1','-d',env['ENGINE_DATABASE_NAME'],'-Atc',q])
 active="((kind='film-image-preview' and data->>'status' in ('queued','running')) or (kind='job' and coalesce(data->>'cloudStopped','false')!='true' and data->>'action' in ('start','generate','prepare')) or (kind='rental' and data->>'state'!='closed') or (kind='text-call' and data->>'status' in ('queued','running')) or (kind='film-project' and coalesce(data->>'textPending','false') not in ('false','null','')))"
 assert sql("select count(*) from iff_records where "+active+" and not(kind='job' and id='"+JOB+"' and data->>'action'='prepare')")=='0','UNRELATED_ACTIVE_WORK'
 old={n:(ROOT/n).read_bytes() for n in m};payload={n:get(BASE+commit+'/'+n) for n in m}
 for n in m:assert sha(old[n])==m[n]['before'] and sha(payload[n])==m[n]['after'],'SOURCE_CHANGED'
 backup=pathlib.Path('/root/codex-preparation-closure-before-'+commit[:12]);backup.mkdir(mode=0o700)
 for n,b in old.items():p=backup/n.replace('/','-');p.write_bytes(b);p.chmod(0o600)
 candidates={}
 for n,b in payload.items():
  p=ROOT/n;t=p.with_name(p.stem+'.closure-candidate'+p.suffix);t.write_bytes(b);t.chmod(0o644)
  if p.suffix=='.py':compile(b,str(t),'exec')
  else:run(['/opt/node-v24.14.1-linux-x64/bin/node','--check',str(t)])
  candidates[n]=t
 host='services/film-engine/engine/host_account_transfer.py'
 os.replace(candidates[host],ROOT/host)
 # The already-approved monitor reads a durable no-call receipt. It cannot
 # dispatch anything through this new terminal branch.
 for _ in range(60):
  if sql("select count(*) from iff_records where "+active)=='0':break
  time.sleep(.5)
 else:raise AssertionError('CLOSURE_NOT_ADOPTED_NO_RESTART')
 assert sql("select count(*) from iff_records where kind='job' and id='"+JOB+"' and data->>'cloudStopped'='true'")=='1','JOB_NOT_CLOSED'
 # Correct an estimate of control-plane waiting; actual provider invoice stays unknown.
 saved=sql("select jsonb_build_object('elapsedSeconds',data->'elapsedSeconds','estimatedUSD',data->'estimatedUSD') from iff_records where kind='job' and id='"+JOB+"'")
 p=backup/'old-estimate.json';p.write_text(saved);p.chmod(0o600)
 sql("update iff_records set data=data||jsonb_build_object('estimatedUSD',null,'modelComputeUSD',0,'monitorWallSeconds',data->'elapsedSeconds','elapsedSeconds',greatest(0,(data->'result'->>'setupFailedAt')::double precision-(data->>'startedAt')::double precision/1000)) where kind='job' and id='"+JOB+"' and data->'result'->>'noModelCallsStarted'='true' and data->'result'->>'setupFailedAt' is not null")
 sql("insert into iff_audit(id,at,action,subject) values('"+str(uuid.uuid4())+"',"+str(int(time.time()*1000))+",'unstarted_compute_estimate_corrected','"+JOB+"')")
 restart_attempted=False
 try:
  for n,t in candidates.items():
   if n!=host:os.replace(t,ROOT/n)
  assert sql("select count(*) from iff_records where "+active)=='0','NEW_ACTIVE_WORK_NO_RESTART'
  restart_attempted=True
  run(['systemctl','restart','iraq-ai-film-platform-staging']);time.sleep(2)
  assert run(['systemctl','is-active','iraq-ai-film-platform-staging'])=='active','SERVICE_HEALTH'
  assert json.loads(get('http://127.0.0.1:3480/health')).get('status')=='ok','GATEWAY_HEALTH'
 except Exception:
  for n,b in old.items():(ROOT/n).write_bytes(b)
  if restart_attempted:run(['systemctl','restart','iraq-ai-film-platform-staging'])
  raise
 print(json.dumps({'installed':True,'jobClosed':True,'activeWorkBeforeRestart':0,'backup':str(backup),'gpuJobsStarted':0,'modelTransfers':0}))
if __name__=='__main__':main()
