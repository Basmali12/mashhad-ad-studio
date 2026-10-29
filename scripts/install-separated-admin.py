"""Upgrade the existing scan/reels-admin site only; no DNS, account or GPU actions."""
import hashlib,json,os,pathlib,re,shutil,subprocess,sys,time,urllib.request,urllib.error
PAGES='ac1842cac2867e6fea62f5aef4703280047608d8'
BASE='https://raw.githubusercontent.com/Basmali12/mashhad-ad-studio/'
def run(args):return subprocess.run(args,capture_output=True,text=True,check=True,timeout=45)
def digest(b):return hashlib.sha256(b.replace(b'\r\n',b'\n')).hexdigest()
def get(url,limit=4194304):
 with urllib.request.urlopen(url,timeout=25) as r:
  b=r.read(limit+1);assert len(b)<=limit,'DOWNLOAD_SIZE';return b
def request_status(origin,method='OPTIONS',body=None):
 headers={'Origin':origin,'Content-Type':'application/json'}
 if method=='OPTIONS':headers.update({'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'})
 req=urllib.request.Request('https://scan.iraqaistudio.com/api/mashhad-film',data=body,headers=headers,method=method)
 try:
  with urllib.request.urlopen(req,timeout=15) as r:return r.status,r.headers.get('Access-Control-Allow-Origin')
 except urllib.error.HTTPError as e:return e.code,e.headers.get('Access-Control-Allow-Origin')
def main():
 assert os.geteuid()==0
 commit=sys.argv[1];assert re.fullmatch('[a-f0-9]{40}',commit)
 manifest=json.loads(get(BASE+commit+'/scripts/separated-admin-manifest.json',32768))
 assert manifest['schema']==1 and len(manifest['files'])<=25 and sum(f['bytes'] for f in manifest['files'])<4194304
 gateway=pathlib.Path('/srv/mashhad-film/current/services/film-gateway/gateway.mjs')
 gateway_env=pathlib.Path('/etc/mashhad-film/gateway.env');caddy=pathlib.Path('/etc/caddy/Caddyfile')
 old_code=gateway.read_bytes();old_env=gateway_env.read_text();old_caddy=caddy.read_text()
 assert digest(old_code)==manifest['gatewayBefore'],'UNREVIEWED_GATEWAY'
 old_root='root * /opt/mashhad/reels/current/admin';assert old_caddy.count(old_root)==1,'UNREVIEWED_ADMIN_ROUTE'
 current=pathlib.Path('/srv/mashhad-admin/current');assert not current.exists() and not current.is_symlink(),'UNREVIEWED_ADMIN_RELEASE'
 assert all(not l.startswith('MASHHAD_FILM_ADMIN_ORIGIN=') or l=='MASHHAD_FILM_ADMIN_ORIGIN=https://scan.iraqaistudio.com' for l in old_env.splitlines()),'UNREVIEWED_ADMIN_ORIGIN'
 engine_env=dict(l.split('=',1) for l in pathlib.Path('/etc/iraq-ai-film-platform-staging/film.env').read_text().splitlines() if '=' in l and not l.startswith('#'))
 query="select count(*) from iff_records where (kind='film-image-preview' and data->>'status' in ('queued','running')) or (kind='job' and coalesce(data->>'cloudStopped','false')!='true' and data->>'action' in ('start','generate','prepare')) or (kind='rental' and data->>'state'!='closed') or (kind='text-call' and data->>'status' in ('queued','running')) or (kind='film-project' and coalesce(data->>'textPending','false') not in ('false','null',''))"
 def idle():assert run(['runuser','-u','postgres','--','psql','-d',engine_env['ENGINE_DATABASE_NAME'],'-Atc',query]).stdout.strip()=='0','ACTIVE_WORK_NO_RESTART'
 idle()
 new_code=get(BASE+commit+'/services/film-gateway/gateway.mjs');assert digest(new_code)==manifest['gatewayAfter'],'GATEWAY_HASH'
 release=pathlib.Path('/srv/mashhad-admin/releases')/commit[:12];assert not release.exists(),'RELEASE_ALREADY_EXISTS'
 release.mkdir(mode=0o755,parents=True)
 for item in manifest['files']:
  name=item['path'];assert re.fullmatch('[A-Za-z0-9_./-]+',name) and '..' not in name and not name.startswith('/'),'INVALID_PUBLIC_PATH'
  b=get(BASE+PAGES+'/admin/'+name)
  if pathlib.Path(name).suffix in ['.html','.js','.css','.json','.webmanifest']:b=b.replace(b'\r\n',b'\n')
  assert len(b)==item['bytes'] and hashlib.sha256(b).hexdigest()==item['sha256'],'PUBLIC_ASSET_HASH'
  target=release/name;assert target.resolve().is_relative_to(release.resolve());target.parent.mkdir(mode=0o755,parents=True,exist_ok=True);target.write_bytes(b);target.chmod(0o644)
 assert 'FilmAdminEntry-' in ''.join(p.read_text() for p in (release/'assets').glob('admin-*.js')),'MISSING_ENGINE_ADMIN'
 backup=pathlib.Path('/root/codex-separate-admin-before-20261030-'+commit[:8]);backup.mkdir(mode=0o700)
 for name,b in [('gateway.mjs',old_code),('gateway.env',old_env.encode()),('Caddyfile',old_caddy.encode())]:
  p=backup/name;p.write_bytes(b);p.chmod(0o600)
 idle()
 try:
  candidate=gateway.with_name('gateway.admin-candidate.mjs');candidate.write_bytes(new_code);candidate.chmod(0o644);run(['/opt/node-v24.14.1-linux-x64/bin/node','--check',str(candidate)]);os.replace(candidate,gateway)
  lines=[l for l in old_env.splitlines() if not l.startswith('MASHHAD_FILM_ADMIN_ORIGIN=')];gateway_env.write_text('\n'.join(lines+['MASHHAD_FILM_ADMIN_ORIGIN=https://scan.iraqaistudio.com'])+'\n');gateway_env.chmod(0o600)
  current.parent.mkdir(mode=0o755,parents=True,exist_ok=True);current.symlink_to(release,target_is_directory=True)
  caddy.write_text(old_caddy.replace(old_root,'root * /srv/mashhad-admin/current'))
  run(['caddy','validate','--config',str(caddy)]);run(['systemctl','restart','mashhad-film-gateway']);assert run(['systemctl','is-active','mashhad-film-gateway']).stdout.strip()=='active'
  # systemd active is not HTTP readiness; Node must finish loading the gateway first.
  for attempt in range(30):
   try:
    if json.loads(get('http://127.0.0.1:3480/health',4096)).get('status')=='ok':break
   except Exception:pass
   time.sleep(.2)
  else:raise AssertionError('GATEWAY_HTTP_NOT_READY')
  run(['systemctl','reload','caddy'])
  assert (release/'index.html').read_bytes()==get('https://scan.iraqaistudio.com/reels-admin/'),'PUBLIC_ADMIN_MISMATCH'
  admin_cors=request_status('https://scan.iraqaistudio.com');assert admin_cors==(204,'https://scan.iraqaistudio.com'),'ADMIN_CORS_'+str(admin_cors)
  assert request_status('https://iraqaistudio.com')==(204,'https://iraqaistudio.com'),'CUSTOMER_CORS'
  assert request_status('https://untrusted.invalid')[0]==403,'FOREIGN_ORIGIN'
  assert request_status('https://scan.iraqaistudio.com','POST',b'{}')[0]==401,'MISSING_BEARER_NOT_DENIED'
 except Exception:
  gateway.write_bytes(old_code);gateway_env.write_text(old_env);gateway_env.chmod(0o600);caddy.write_text(old_caddy)
  if current.is_symlink() and current.resolve()==release:current.unlink()
  run(['systemctl','restart','mashhad-film-gateway']);run(['systemctl','reload','caddy']);raise
 print(json.dumps({'installed':True,'adminURL':'https://scan.iraqaistudio.com/reels-admin/','adminOriginRequiresServerRole':True,'customerCommandsOnAdminOrigin':False,'dnsChanged':False,'gpuJobsStarted':0,'modelTransfers':0,'publicFiles':len(manifest['files'])}))
if __name__=='__main__':main()
