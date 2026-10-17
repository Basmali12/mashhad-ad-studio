#!/usr/bin/env bash
set -euo pipefail
umask 077
backup=/opt/mashhad/account-routing-backup-20261010
install -d -m 700 "$backup"
for name in service.ts personal-flow.ts chrome-connection.ts; do test -f "$backup/$name" || cp "/opt/mashhad/worker/$name" "$backup/$name"; done
systemctl stop mashhad-worker
for name in service.ts personal-flow.ts chrome-connection.ts account-flow.ts; do install -m 644 "/tmp/mashhad-flow-accounts/worker/$name" "/opt/mashhad/worker/$name"; done
systemctl start mashhad-worker
systemctl is-active mashhad-worker mashhad-flow-accounts mashhad-flow-trial-chrome
