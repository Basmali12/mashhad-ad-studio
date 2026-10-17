import json
import shutil
import subprocess
from pathlib import Path

def active(unit):
    return subprocess.run(['systemctl', 'is-active', '--quiet', unit]).returncode == 0

if not active('mashhad-flow-trial-chrome') or not active('mashhad-worker'):
    raise RuntimeError('Personal browser and worker must be active before retirement')
env = Path('/etc/mashhad-worker.env').read_text()
if 'OWNER_FLOW_ENDPOINT=http://127.0.0.1:9432' not in env or 'MASHHAD_OWNER_ONLY=true' not in env:
    raise RuntimeError('Personal worker route is not pinned')
units = ['mashhad-flow-accounts', 'mashhad-chrome', 'mashhad-display', 'mashhad-viewer', 'mashhad-novnc', 'mashhad-account-chrome', 'mashhad-account-display', 'mashhad-account-viewer', 'mashhad-account-novnc']
for unit in units:
    if Path('/etc/systemd/system/' + unit + '.service').exists():
        subprocess.run(['systemctl', 'disable', '--now', unit], check=True, capture_output=True)
if any(active(u) for u in units):
    raise RuntimeError('Legacy service is still active')
base = Path('/var/lib/mashhad-flow-accounts')
targets = [Path('/var/lib/mashhad/chrome-profile')]
if base.exists():
    if base.is_symlink() or base.resolve() != base:
        raise RuntimeError('Unexpected profile directory')
    targets += [p for p in base.iterdir() if p.name in ['mashhad-f' + str(i) for i in range(8)] or p.name == 'profiles.json']
for p in targets:
    if p.is_symlink() or (p.exists() and p.resolve() != p):
        raise RuntimeError('Unexpected legacy target')
removed = 0
freed = 0
for p in targets:
    if not p.exists():
        continue
    freed += sum(f.stat().st_size for f in p.rglob('*') if f.is_file() and not f.is_symlink()) if p.is_dir() else p.stat().st_size
    if p.is_dir():
        shutil.rmtree(p)
    else:
        p.unlink()
    removed += 1
print(json.dumps({'legacyTargetsRemoved': removed, 'releasedBytes': freed, 'legacyServicesActive': any(active(u) for u in units), 'personalBrowserActive': active('mashhad-flow-trial-chrome'), 'workerActive': active('mashhad-worker')}))
