#!/usr/bin/env bash
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
p=Path('/etc/systemd/system/mashhad-flow-trial-chrome.service');s=p.read_text()
if '--remote-debugging-port=9432' not in s:
 s=s.replace('--no-first-run','--remote-debugging-address=127.0.0.1 --remote-debugging-port=9432 --no-first-run');p.write_text(s)
PY
systemctl daemon-reload
systemctl restart mashhad-flow-trial-chrome
curl -s --retry 10 --retry-delay 1 --retry-connrefused -o /dev/null -w 'owner_browser=%{http_code}\n' http://127.0.0.1:9432/json/version
systemctl is-active mashhad-flow-trial-chrome mashhad-worker
