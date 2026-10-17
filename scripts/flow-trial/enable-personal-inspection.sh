#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
import json
from pathlib import Path
s=json.loads(Path('/var/lib/mashhad/service-status.json').read_text())
if s.get('activeJobs'):raise SystemExit('Worker busy; personal inspection update stopped')
PY
backup=/opt/mashhad/personal-inspection-backup-20261011
mkdir -p "$backup"
chmod 700 "$backup"
for name in service.ts personal-flow.ts; do
 test -f "$backup/$name" || cp "/opt/mashhad/worker/$name" "$backup/$name"
done
test -f "$backup/worker.env" || cp /etc/mashhad-worker.env "$backup/worker.env"
chmod 600 "$backup/worker.env"
systemctl stop mashhad-worker
cp /tmp/service.ts /opt/mashhad/worker/service.ts
cp /tmp/personal-flow.ts /opt/mashhad/worker/personal-flow.ts
python3 - <<'PY'
from pathlib import Path
p=Path('/etc/mashhad-worker.env')
lines=[x for x in p.read_text().splitlines() if not x.startswith('MASHHAD_OWNER_ONLY=')]
lines.append('MASHHAD_OWNER_ONLY=true')
p.write_text('\n'.join(lines)+'\n')
p.chmod(0o600)
PY
systemctl start mashhad-worker
systemctl is-active mashhad-worker
