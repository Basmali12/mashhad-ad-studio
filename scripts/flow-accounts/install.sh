#!/usr/bin/env bash
set -euo pipefail
umask 077
test "$(id -u)" = 0
install -d -m 711 /var/lib/mashhad-flow-accounts
install -d -m 755 /opt/mashhad-flow-accounts
for name in server.mjs profiles.mjs google-login.mjs index.html network.sh; do install -m 644 "/tmp/mashhad-flow-accounts/$name" "/opt/mashhad-flow-accounts/$name"; done
id mashhad-bridge >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin mashhad-bridge
for n in $(seq 0 7); do
 user="mashhad-f$n";home="/var/lib/mashhad-flow-accounts/$user"
 id "$user" >/dev/null 2>&1 || useradd --system --create-home --home-dir "$home" --shell /usr/sbin/nologin "$user"
 install -d -m 700 -o "$user" -g "$user" "$home" "$home/chrome-profile" "$home/chrome-profile/Default"
 runuser -u "$user" -- touch "$home/.Xauthority"
 if ! test -f "$home/chrome-profile/Default/Preferences"; then
  printf '%s' '{"credentials_enable_service":false,"profile":{"password_manager_enabled":false},"session":{"restore_on_startup":1}}' > "$home/chrome-profile/Default/Preferences"
  chown "$user:$user" "$home/chrome-profile/Default/Preferences";chmod 600 "$home/chrome-profile/Default/Preferences"
 fi
done
# Private parent traversable only by each profile owner; no cross-account read permission.
chmod 711 /var/lib/mashhad-flow-accounts
cat > /etc/systemd/system/mashhad-flow-accounts.service <<'UNIT'
[Unit]
Description=Mashhad authenticated private Flow account gateway
After=network-online.target
[Service]
ExecStart=/usr/local/bin/node /opt/mashhad-flow-accounts/server.mjs
ExecStartPre=/bin/bash /opt/mashhad-flow-accounts/network.sh
User=root
Group=root
UMask=0077
Restart=on-failure
RestartSec=5
MemoryMax=180M
ProtectHome=true
PrivateTmp=false
ProtectSystem=strict
ReadWritePaths=/var/lib/mashhad-flow-accounts /run /tmp
[Install]
WantedBy=multi-user.target
UNIT
python3 - <<'PY'
from pathlib import Path
p=Path('/etc/caddy/Caddyfile');s=p.read_text()
block='''    redir /flow-account /flow-account/ 308
    handle /flow-account/* {
        reverse_proxy 127.0.0.1:43137
    }
'''
if 'handle /flow-account/*' not in s:
 marker='    handle /flow-trial/* {'
 if s.count(marker)!=1:raise SystemExit('Unexpected proxy configuration')
 backup=p.with_name('Caddyfile.before-flow-accounts-20261010')
 if not backup.exists():backup.write_text(s)
 candidate=p.with_name('Caddyfile.flow-accounts-candidate');candidate.write_text(s.replace(marker,block+marker))
PY
if test -f /etc/caddy/Caddyfile.flow-accounts-candidate; then
 caddy validate --config /etc/caddy/Caddyfile.flow-accounts-candidate --adapter caddyfile
 cp /etc/caddy/Caddyfile.flow-accounts-candidate /etc/caddy/Caddyfile
 systemctl reload caddy
fi
systemctl daemon-reload
systemctl enable mashhad-flow-accounts
systemctl restart mashhad-flow-accounts
systemctl is-active mashhad-flow-accounts mashhad-worker mashhad-flow-trial-chrome
