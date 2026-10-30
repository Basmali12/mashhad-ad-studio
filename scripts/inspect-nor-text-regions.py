"""CPU-only diagnostic for an immutable existing Nor video. No acceptance writes."""
import contextlib,hashlib,importlib.util,io,json,os,pathlib,socket,subprocess,sys

def worker():
 source=pathlib.Path(sys.argv[2]);module_file=pathlib.Path(sys.argv[3])
 assert hashlib.sha256(source.read_bytes()).hexdigest()=='483d94711781c81ec3c2ac5ef8b8e915b057f479b4d81a1b0f65160a03c16a0c','SOURCE_CHANGED'
 spec=importlib.util.spec_from_file_location('video_text_diagnostic',module_file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 with contextlib.redirect_stdout(io.StringIO()):info=module.scan(source,module.detector(),'diagnostic_only')
 groups={}
 for index,boxes in enumerate(info['frames']):
  for box in boxes:
   xs=[float(p[0]) for p in box];ys=[float(p[1]) for p in box]
   rect=[round(min(xs)),round(min(ys)),round(max(xs)),round(max(ys))]
   key=(round((rect[0]+rect[2])/96),round((rect[1]+rect[3])/96))
   row=groups.setdefault(key,{'frame':index,'seconds':round(index/info['fps'],3),'rect':rect,'count':0});row['count']+=1
 result={'gpuUsed':False,'originalUnchanged':hashlib.sha256(source.read_bytes()).hexdigest()=='483d94711781c81ec3c2ac5ef8b8e915b057f479b4d81a1b0f65160a03c16a0c','frames':len(info['frames']),'flaggedFrames':info['text_frames'],'boxes':info['box_count'],'regions':sorted(groups.values(),key=lambda row:row['count'],reverse=True)[:8]}
 pathlib.Path('/root/codex-nor-regions-06b0530b.json').write_text(json.dumps({'summary':result,'frames':info['frames']},indent=2));os.chmod('/root/codex-nor-regions-06b0530b.json',0o600)
 print(json.dumps(result))

def main():
 assert socket.gethostname()=='muhtaj-app'
 pid=subprocess.check_output(['systemctl','show','-p','MainPID','--value','iraq-ai-film-platform-staging'],text=True).strip();assert pid.isdigit() and int(pid)>0
 env=dict(p.decode().split('=',1) for p in pathlib.Path('/proc/'+pid+'/environ').read_bytes().split(b'\0') if b'=' in p)
 query="select data->>'cloudStopped' from iff_records where kind='job' and id='06b0530b-a288-4f9f-92fa-fa4c2ff967a5'"
 # The storage key column is deployment-specific; select the immutable data id.
 query="select data->>'cloudStopped' from iff_records where kind='job' and data->>'id'='06b0530b-a288-4f9f-92fa-fa4c2ff967a5'"
 assert subprocess.check_output(['runuser','-u','postgres','--','psql','-d',env['ENGINE_DATABASE_NAME'],'-Atc',query],text=True).strip()=='true','JOB_NOT_STOPPED'
 folder=pathlib.Path(env['FILM_DATA_DIR'])/'artifacts/06b0530b-a288-4f9f-92fa-fa4c2ff967a5'
 cwd=pathlib.Path('/proc/'+pid+'/cwd').resolve()
 safe={k:env[k] for k in ['PATH','ENGINE_TEXT_DETECTOR_MODEL'] if k in env};safe.update(CUDA_VISIBLE_DEVICES='',NVIDIA_VISIBLE_DEVICES='void',PYTHONUTF8='1')
 subprocess.run([env['ENGINE_TEXT_QC_PYTHON'],str(pathlib.Path(__file__).resolve()),'--worker',str(folder/'video.mp4'),str(cwd/'engine/video_text.py')],env=safe,check=True,timeout=300)

if __name__=='__main__':
 try:worker() if '--worker' in sys.argv else main()
 except Exception as error:print(json.dumps({'diagnosticFailed':True,'errorClass':type(error).__name__,'gpuCalls':0}));sys.exit(1)
