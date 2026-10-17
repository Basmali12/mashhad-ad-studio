#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
import json
from pathlib import Path
s=json.loads(Path('/var/lib/mashhad/service-status.json').read_text())
if s.get('activeJobs'):raise SystemExit('Worker busy; deployment stopped')
PY
backup=/opt/mashhad/owner-routing-backup-20261010
mkdir -p "$backup"
chmod 700 "$backup"
for name in browser.ts service.ts chrome-connection.ts; do
 test -f "$backup/$name" || cp "/opt/mashhad/worker/$name" "$backup/$name"
done
test -f "$backup/worker.env" || cp /etc/mashhad-worker.env "$backup/worker.env"
chmod 600 "$backup/worker.env"
systemctl stop mashhad-worker
for name in browser.ts service.ts chrome-connection.ts personal-flow.ts; do
 cp "/tmp/mashhad-flow-trial/worker/$name" "/opt/mashhad/worker/$name"
done
python3 - <<'PY'
from pathlib import Path
p=Path('/etc/mashhad-worker.env');s=p.read_text();lines=s.splitlines();lines=[x for x in lines if not x.startswith('OWNER_FLOW_ENDPOINT=')];lines.append('OWNER_FLOW_ENDPOINT=http://127.0.0.1:9432');p.write_text('\n'.join(lines)+'\n');p.chmod(0o600)
PY
systemctl start mashhad-worker
systemctl is-active mashhad-worker mashhad-flow-trial-chrome
