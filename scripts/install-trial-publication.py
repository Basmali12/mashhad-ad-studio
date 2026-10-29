"""Owner-approved trial catalog publication support; never starts GPU resources."""
import hashlib,json,os,pathlib,re,shutil,subprocess,sys,urllib.request
BASE_HASHES={'services/film-engine/engine/film-platform.mjs': '4188530f92437945f4fcea77739e6a203e32ce7a1fff52e64704072fbb5c638e', 'services/film-gateway/film-bridge.mjs': '76f23c471fa4d98da4304bd08c656ae789a3bf36bcdb9e5f6326f68f3c9aa104'}
NEW_HASHES={'services/film-engine/engine/film-platform.mjs': 'cfa7f4c351c34496a9da0bb96b353d1f58288e2fcafdb056ad671ba8f69eb862', 'services/film-gateway/film-bridge.mjs': 'aab9a871e0097ba7f14e17e89782a413a6d853acea109237ebefdc9525f178d2'}
def sha(data):return hashlib.sha256(data.replace(b'\r\n',b'\n')).hexdigest()
def run(args):return subprocess.run(args,capture_output=True,text=True,check=True,timeout=45)
def main():
 assert os.geteuid()==0
 commit=sys.argv[1];assert re.fullmatch('[a-f0-9]{40}',commit)
 env=dict(l.split('=',1) for l in pathlib.Path('/etc/iraq-ai-film-platform-staging/film.env').read_text().splitlines() if '=' in l and not l.startswith('#'))
 q="select count(*) from iff_records where (kind='job' and coalesce(data->>'cloudStopped','false')!='true' and data->>'action' in ('start','generate','prepare')) or (kind='rental' and data->>'state'!='closed')"
 assert run(['runuser','-u','postgres','--','psql','-d',env['ENGINE_DATABASE_NAME'],'-Atc',q]).stdout.strip()=='0','ACTIVE_WORK_NO_RESTART'
 targets={'services/film-engine/engine/film-platform.mjs':pathlib.Path('/srv/iraq-ai-studio-staging/current/services/film-engine/engine/film-platform.mjs'),'services/film-gateway/film-bridge.mjs':pathlib.Path('/srv/mashhad-film/current/services/film-gateway/film-bridge.mjs')}
 for name,digest in BASE_HASHES.items():assert sha(targets[name].read_bytes())==digest,'UNREVIEWED_SERVER_SOURCE'
 payload={}
 for name,digest in NEW_HASHES.items():
  b=urllib.request.urlopen('https://raw.githubusercontent.com/Basmali12/mashhad-ad-studio/'+commit+'/'+name,timeout=25).read();assert sha(b)==digest;payload[name]=b
 backup=pathlib.Path('/root/codex-trial-publication-before-20261029');backup.mkdir(mode=0o700)
 for name,target in targets.items():shutil.copy2(target,backup/target.name)
 try:
  for name,b in payload.items():
   target=targets[name];candidate=target.with_name(target.name+'.trial-candidate');candidate.write_bytes(b);candidate.chmod(0o644);os.replace(candidate,target)
   run(['/opt/node-v24.14.1-linux-x64/bin/node','--check',str(target)])
  for unit in ['iraq-ai-film-platform-staging','mashhad-film-gateway']:run(['systemctl','restart',unit]);assert run(['systemctl','is-active',unit]).stdout.strip()=='active'
 except Exception:
  for target in targets.values():shutil.copy2(backup/target.name,target)
  for unit in ['iraq-ai-film-platform-staging','mashhad-film-gateway']:run(['systemctl','restart',unit])
  raise
 print(json.dumps({'installed':True,'newGPUJobs':0,'catalogChangedByInstaller':False,'note':'Publication must be requested through the authenticated administrator UI.'}))
if __name__=='__main__':main()
