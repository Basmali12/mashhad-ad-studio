"""Deploy approved self-service commissioning; idle-only, rollback, no provider operations."""
import hashlib,json,os,pathlib,re,shutil,subprocess,sys,time,urllib.request
BASE='https://raw.githubusercontent.com/Basmali12/mashhad-ad-studio/'
def get(url):
 with urllib.request.urlopen(url,timeout=30) as r:
  b=r.read(4194305);assert len(b)<=4194304;return b
def sha(b):return hashlib.sha256(b.replace(b'\r\n',b'\n')).hexdigest()
def run(args):return subprocess.run(args,capture_output=True,text=True,check=True,timeout=45)
def main():
 assert os.geteuid()==0
 commit=sys.argv[1];assert re.fullmatch('[a-f0-9]{40}',commit)
 m=json.loads(get(BASE+commit+'/scripts/admin-commissioning-release.json'))
 env=dict(l.split('=',1) for l in pathlib.Path('/etc/iraq-ai-film-platform-staging/film.env').read_text().splitlines() if '=' in l and not l.startswith('#'))
 query="select count(*) from iff_records where (kind='film-image-preview' and data->>'status' in ('queued','running')) or (kind='job' and coalesce(data->>'cloudStopped','false')!='true' and data->>'action' in ('start','generate','prepare')) or (kind='rental' and data->>'state'!='closed') or (kind='text-call' and data->>'status' in ('queued','running')) or (kind='film-project' and coalesce(data->>'textPending','false') not in ('false','null',''))"
 def idle():assert run(['runuser','-u','postgres','--','psql','-d',env['ENGINE_DATABASE_NAME'],'-Atc',query]).stdout.strip()=='0','ACTIVE_WORK_NO_RESTART'
 idle();current=pathlib.Path('/srv/mashhad-admin/current');assert current.is_symlink(),'ADMIN_RELEASE_UNKNOWN'
 old_release=current.resolve();assert re.fullmatch('[a-f0-9]{12}',m['expectedAdminRelease'])
 assert old_release==pathlib.Path('/srv/mashhad-admin/releases')/m['expectedAdminRelease'],'ADMIN_RELEASE_CHANGED'
 targets={n:pathlib.Path('/srv/iraq-ai-studio-staging/current' if n.startswith('services/film-engine/') else '/srv/mashhad-film/current')/n for n in m['sources']}
 old={n:p.read_bytes() if p.exists() else None for n,p in targets.items()}
 for n,b in old.items():assert (sha(b) if b is not None else None)in m['sources'][n]['before'],'SOURCE_CHANGED_'+n
 payload={n:get(BASE+commit+'/'+n) for n in targets}
 for n,b in payload.items():assert sha(b)==m['sources'][n]['after'],'SOURCE_HASH'
 release=current.parent/'releases'/commit[:12];assert not release.exists(),'RELEASE_EXISTS';release.mkdir(parents=True,mode=0o755)
 for item in m['files']:
  n=item['path'];assert re.fullmatch('[A-Za-z0-9_./-]+',n) and '..' not in n and not n.startswith('/')
  b=get(BASE+m['pagesCommit']+'/admin/'+n)
  if pathlib.Path(n).suffix in ['.html','.js','.css','.json','.webmanifest']:b=b.replace(b'\r\n',b'\n')
  assert len(b)==item['bytes'] and hashlib.sha256(b).hexdigest()==item['sha256'],'ASSET_HASH'
  target=release/n;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(b);target.chmod(0o644)
 backup=pathlib.Path('/root/codex-admin-commissioning-before-'+commit[:12]);backup.mkdir(mode=0o700)
 for n,b in old.items():
  if b is not None:
   p=backup/n.replace('/','-');p.write_bytes(b);p.chmod(0o600)
 (backup/'admin-root.txt').write_text(str(old_release));idle()
 units=(['iraq-ai-film-platform-staging'] if any(n.startswith('services/film-engine/') for n in targets) else [])+(['mashhad-film-gateway'] if any(n.startswith('services/film-gateway/') or n.startswith('shared/') for n in targets) else [])
 try:
  for n,p in targets.items():
   candidate=p.with_name(p.stem+'.setup-candidate'+p.suffix);candidate.write_bytes(payload[n]);candidate.chmod(0o644)
   if p.suffix=='.mjs':run(['/opt/node-v24.14.1-linux-x64/bin/node','--check',str(candidate)])
   elif p.suffix=='.py':compile(payload[n],str(candidate),'exec')
   os.replace(candidate,p)
  for unit in units:run(['systemctl','restart',unit])
  for attempt in range(40):
   try:
    if json.loads(get('http://127.0.0.1:3480/health')).get('status')=='ok':break
   except Exception:pass
   time.sleep(.25)
  else:raise AssertionError('GATEWAY_HEALTH')
  assert all(run(['systemctl','is-active',u]).stdout.strip()=='active' for u in units),'SERVICE_HEALTH'
  candidate=current.with_name('current-setup-candidate');candidate.symlink_to(release,target_is_directory=True);os.replace(candidate,current)
  assert get('https://scan.iraqaistudio.com/reels-admin/')==(release/'index.html').read_bytes(),'PUBLIC_ADMIN_MISMATCH'
 except Exception:
  for n,p in targets.items():
   if old[n] is None:p.unlink(missing_ok=True)
   else:p.write_bytes(old[n])
  if current.resolve()!=old_release:
   candidate=current.with_name('current-setup-rollback');candidate.symlink_to(old_release,target_is_directory=True);os.replace(candidate,current)
  for unit in units:run(['systemctl','restart',unit])
  raise
 print(json.dumps({'installed':True,'adminRelease':commit[:12],'activeWorkBeforeRestart':0,'backup':str(backup),'gpuJobsStarted':0,'modelTransfers':0}))
if __name__=='__main__':main()
