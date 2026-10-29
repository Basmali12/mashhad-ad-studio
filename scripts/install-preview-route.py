"""Route only signed concept-image reads to the existing film-ticket handler."""
import os,pathlib,re,subprocess,urllib.request,urllib.error
assert os.geteuid()==0
p=pathlib.Path('/etc/caddy/Caddyfile');original=p.read_bytes();text=original.decode();matches=list(re.finditer(r'^([ \t]*@film_tickets[ \t]+path[^\n]*)(\n|$)',text,re.M));assert len(matches)==1,'UNREVIEWED_PROXY_LAYOUT'
m=matches[0];assert '/api/film-media/*' in m.group(1) and '/api/film-reference-view/*' in m.group(1) and '/api/film-preview/*' not in text,'UNREVIEWED_PROXY_STATE'
backup=pathlib.Path('/root/codex-final-film-before-20261030/Caddyfile-before-preview-route');assert not backup.exists();backup.write_bytes(original);backup.chmod(0o600)
updated=text[:m.start(1)]+m.group(1)+' /api/film-preview/*'+text[m.end(1):]
def run(args):return subprocess.run(args,capture_output=True,text=True,check=True,timeout=45)
try:
 p.write_text(updated);run(['caddy','validate','--config',str(p)]);run(['systemctl','reload','caddy'])
 try:urllib.request.urlopen('https://studio.iraqaistudio.com/api/film-preview/readiness-probe',timeout=20);raise AssertionError('UNSIGNED_IMAGE_READ_ALLOWED')
 except urllib.error.HTTPError as e:assert e.code==403,'PREVIEW_ROUTE_NOT_REACHED'
except Exception:
 p.write_bytes(original);run(['systemctl','reload','caddy']);raise
print('{"signedPreviewRoute":true,"unsignedReadDenied":true,"gpuJobs":0,"paidCalls":0}')
