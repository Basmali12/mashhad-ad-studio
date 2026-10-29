"""Explicit root maintenance only. No GPU, SDK, billing or model operations.

Usage: python3 install-film-artifact-preflight.py <reviewed-source-commit>
Downloads only three hash-verified source files from this repository. Refuses
unknown source revisions or active film work and preserves rollback copies.
"""
import hashlib,json,os,pathlib,pwd,re,shutil,subprocess,sys,urllib.request
EXPECTED_BASE={'services/film-engine/engine/api.mjs': '5fc14b8069d837a8c0490af3933e62db64b2e4018036c10247f4ee6365ccac68', 'services/film-gateway/film-bridge.mjs': 'e94ad13c20f3aa2418b9282d77ba04d280cf73e9b909900dae434cf383a197f9'}
PAYLOAD_HASHES={'services/film-engine/engine/api.mjs': '4e3f2bff1f3c17e7bfe9c8178809a025ab1b4c829f0ab40772239880b411d35f', 'services/film-engine/engine/artifact-storage.mjs': 'd98cdecb124f4c47bd5be8bf15d5acb3787bd682ed0cd498520f2bb9363fba07', 'services/film-gateway/film-bridge.mjs': '76f23c471fa4d98da4304bd08c656ae789a3bf36bcdb9e5f6326f68f3c9aa104'}
def sha(data):return hashlib.sha256(data.replace(b'\r\n',b'\n')).hexdigest()
def run(args,**kwargs):return subprocess.run(args,capture_output=True,text=True,check=True,timeout=40,**kwargs)
def main():
 assert os.geteuid()==0,'ROOT_MAINTENANCE_REQUIRED'
 commit=sys.argv[1];assert re.fullmatch('[a-f0-9]{40}',commit)
 envfile=pathlib.Path('/etc/iraq-ai-film-platform-staging/film.env')
 env=dict(l.split('=',1) for l in envfile.read_text().splitlines() if '=' in l and not l.startswith('#'))
 query="select count(*) from iff_records where (kind='job' and coalesce(data->>'cloudStopped','false')!='true' and data->>'action' in ('start','generate','prepare')) or (kind='rental' and data->>'state'!='closed')"
 active=run(['runuser','-u','postgres','--','psql','-d',env['ENGINE_DATABASE_NAME'],'-Atc',query]).stdout.strip();assert active=='0','ACTIVE_WORK_NO_RESTART'
 film=pathlib.Path('/srv/iraq-ai-studio-staging/current/services/film-engine/engine')
 gateway=pathlib.Path('/srv/mashhad-film/current/services/film-gateway')
 destinations={'services/film-engine/engine/api.mjs':film/'api.mjs','services/film-engine/engine/artifact-storage.mjs':film/'artifact-storage.mjs','services/film-gateway/film-bridge.mjs':gateway/'film-bridge.mjs'}
 for name,digest in EXPECTED_BASE.items():assert sha(destinations[name].read_bytes())==digest,'UNKNOWN_SERVER_SOURCE_'+name
 assert not destinations['services/film-engine/engine/artifact-storage.mjs'].exists(),'HELPER_ALREADY_INSTALLED'
 payloads={}
 for name,digest in PAYLOAD_HASHES.items():
  data=urllib.request.urlopen('https://raw.githubusercontent.com/Basmali12/mashhad-ad-studio/'+commit+'/'+name,timeout=25).read()
  assert sha(data)==digest,'DOWNLOAD_HASH_MISMATCH';payloads[name]=data
 backup=pathlib.Path('/root/codex-artifact-write-fix-20261029');backup.mkdir(mode=0o700)
 for name,target in destinations.items():
  if target.exists():shutil.copy2(target,backup/('gateway-bridge.mjs' if name.startswith('services/film-gateway') else target.name))
 for name,data in payloads.items():
  target=destinations[name];tmp=target.with_name(target.name+'.codex-candidate');tmp.write_bytes(data);tmp.chmod(0o644);os.replace(tmp,target)
 try:
  node='/opt/node-v24.14.1-linux-x64/bin/node'
  for target in destinations.values():run([node,'--check',str(target)])
  probe="import {verifyArtifactStorage} from "+json.dumps(str(film/'artifact-storage.mjs'))+"; await verifyArtifactStorage("+json.dumps(env['FILM_DATA_DIR'])+"); console.log('SERVICE_WRITE_PROBE_OK');"
  verified=run(['runuser','-u','iraq-film-staging','--',node,'--input-type=module','-e',probe]).stdout.strip()
  assert verified=='SERVICE_WRITE_PROBE_OK'
  for unit in ['iraq-ai-film-platform-staging','mashhad-film-gateway']:run(['systemctl','restart',unit]);assert run(['systemctl','is-active',unit]).stdout.strip()=='active'
 except Exception:
  for name,target in destinations.items():
   old=backup/('gateway-bridge.mjs' if name.startswith('services/film-gateway') else target.name)
   if old.exists():shutil.copy2(old,target)
  for unit in ['iraq-ai-film-platform-staging','mashhad-film-gateway']:run(['systemctl','restart',unit])
  raise
 print(json.dumps({'installed':True,'serviceIdentityWriteProbe':True,'activeWorkBeforeRestart':0,'backup':str(backup),'newGPUJobs':0,'newModelDownloads':0}))
if __name__=='__main__':main()
