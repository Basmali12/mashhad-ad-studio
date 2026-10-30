"""Read-only diagnostics for the two approved Nor runs; never invokes providers."""
import json,pathlib,socket,subprocess
assert socket.gethostname()=='muhtaj-app'
env=dict(line.split('=',1) for line in pathlib.Path('/etc/iraq-ai-film-platform-staging/film.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
query="select data from iff_records where kind='job' and data->>'accountId'='0e77a689-6b46-493a-827c-346091f5c76b' and data->>'action'='generate' order by (data->>'createdAt')::bigint desc limit 2"
rows=subprocess.run(['runuser','-u','postgres','--','psql','-d',env['ENGINE_DATABASE_NAME'],'-Atc',query],capture_output=True,text=True,check=True,timeout=20).stdout.splitlines()
for row in rows:
 j=json.loads(row);r=j.get('result') or {};q=r.get('textQuality') or {}
 safe={key:j.get(key) for key in ['id','status','cloudStopped','elapsedSeconds','createdAt','startedAt','finishedAt','generationRulesVersion','dialoguePolicyVersion']}
 safe['recordedCost']=r.get('recordedCost');safe['videoSHA']=r.get('sha256')
 safe['textQuality']={key:q.get(key) for key in ['version','status','error','frames_scanned','text_frames_before','boxes_before','ambiguous_small_marks_before','text_frames_after','boxes_after','repair_enabled','seconds','native_audio_bitstream_unchanged']}
 print(json.dumps(safe),flush=True)
print(json.dumps({'readOnly':True,'gpuCalls':0,'providerCalls':0}))
