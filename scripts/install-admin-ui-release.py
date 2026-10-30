"""Static admin release only. Never restarts services or calls GPU providers."""
import hashlib,json,os,pathlib,re,shutil,socket,sys,urllib.request
def get(url):
 with urllib.request.urlopen(url,timeout=30) as response:return response.read(4194304)
def main():
 assert os.geteuid()==0 and socket.gethostname()=='muhtaj-app'
 commit=sys.argv[1];assert re.fullmatch('[a-f0-9]{40}',commit)
 raw='https://raw.githubusercontent.com/Basmali12/mashhad-ad-studio/'
 m=json.loads(get(raw+commit+'/scripts/admin-ui-release.json'))
 current=pathlib.Path('/srv/mashhad-admin/current');assert current.is_symlink()
 old=current.resolve();releases=current.parent/'releases';assert old.parent==releases and (old/'index.html').is_file()
 new=releases/m['pagesCommit'][:12];assert not new.exists(),'RELEASE_EXISTS_INSPECT_NO_REPLAY'
 assert not any(p.is_symlink() for p in old.rglob('*')),'UNEXPECTED_ASSET_SYMLINK'
 payload={}
 for row in m['files']:
  name=row['path'];assert re.fullmatch('[A-Za-z0-9_./-]+',name) and '..' not in name and not name.startswith('/')
  data=get(raw+m['pagesCommit']+'/admin/'+name)
  assert len(data)==row['bytes'] and hashlib.sha256(data).hexdigest()==row['sha256'],'ASSET_HASH'
  payload[name]=data
 shutil.copytree(old,new)
 for name,data in payload.items():
  target=new/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data);target.chmod(0o644)
 backup=pathlib.Path('/root/codex-admin-ui-before-'+m['pagesCommit'][:12]);assert not backup.exists()
 backup.write_text(str(old));backup.chmod(0o600)
 candidate=current.with_name('current-ui-candidate');assert not candidate.exists() and not candidate.is_symlink()
 try:
  candidate.symlink_to(new,target_is_directory=True);os.replace(candidate,current)
  assert get('https://scan.iraqaistudio.com/reels-admin/')==(new/'index.html').read_bytes(),'PUBLIC_INDEX_MISMATCH'
  assert json.loads(get('https://scan.iraqaistudio.com/reels-admin/version.json'))['version']==m['version'],'PUBLIC_VERSION_MISMATCH'
 except Exception:
  rollback=current.with_name('current-ui-rollback');rollback.symlink_to(old,target_is_directory=True);os.replace(rollback,current);raise
 print(json.dumps({'installed':True,'version':m['version'],'adminRelease':m['pagesCommit'][:12],'previousRelease':old.name,'servicesRestarted':0,'gpuStarted':False,'modelTransfers':0,'oldAssetsPreserved':True}))
if __name__=='__main__':
 try:main()
 except Exception as error:print(json.dumps({'installed':False,'errorClass':type(error).__name__,'secretsPrinted':False}));sys.exit(1)
