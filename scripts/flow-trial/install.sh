#!/usr/bin/env bash
set -euo pipefail
umask 077
test "$(id -u)" = 0
# Independent OS user, display, profile and ports. Existing worker is untouched.
id mashhad-trial >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/mashhad-flow-trial --shell /usr/sbin/nologin mashhad-trial
install -d -m 700 -o mashhad-trial -g mashhad-trial /var/lib/mashhad-flow-trial
install -d -m 755 /opt/mashhad-flow-trial
install -m 644 /tmp/mashhad-flow-trial/server.mjs /tmp/mashhad-flow-trial/index.html /opt/mashhad-flow-trial/
runuser -u mashhad-trial -- touch /var/lib/mashhad-flow-trial/.Xauthority
if ! runuser -u mashhad-trial -- xauth -f /var/lib/mashhad-flow-trial/.Xauthority list | grep -q ':100'; then
 runuser -u mashhad-trial -- xauth -f /var/lib/mashhad-flow-trial/.Xauthority add :100 MIT-MAGIC-COOKIE-1 "$(mcookie)"
fi
for unit in display chrome viewer novnc gateway; do
 cat > "/etc/systemd/system/mashhad-flow-trial-$unit.service" <<UNIT
[Unit]
Description=Mashhad isolated owner Flow trial $unit
After=network-online.target
[Service]
User=mashhad-trial
Group=mashhad-trial
Environment=HOME=/var/lib/mashhad-flow-trial DISPLAY=:100 XAUTHORITY=/var/lib/mashhad-flow-trial/.Xauthority
UMask=0077
Restart=on-failure
RestartSec=5
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/mashhad-flow-trial /tmp
[Install]
WantedBy=multi-user.target
UNIT
done
cat >> /etc/systemd/system/mashhad-flow-trial-display.service <<'UNIT'
[Service]
ExecStart=/usr/bin/Xvfb :100 -screen 0 900x1000x24 -nolisten tcp -auth /var/lib/mashhad-flow-trial/.Xauthority
MemoryMax=150M
UNIT
cat >> /etc/systemd/system/mashhad-flow-trial-chrome.service <<'UNIT'
[Unit]
After=mashhad-flow-trial-display.service
Requires=mashhad-flow-trial-display.service
[Service]
ExecStart=/usr/bin/google-chrome-stable --user-data-dir=/var/lib/mashhad-flow-trial/chrome-profile --no-first-run --no-default-browser-check --disable-save-password-bubble --window-size=900,1000 --window-position=0,0 https://labs.google/fx/tools/flow
Restart=always
MemoryMax=1500M
CPUQuota=60%
TimeoutStopSec=30
UNIT
cat >> /etc/systemd/system/mashhad-flow-trial-viewer.service <<'UNIT'
[Unit]
After=mashhad-flow-trial-display.service
Requires=mashhad-flow-trial-display.service
[Service]
ExecStart=/usr/bin/x11vnc -display :100 -auth /var/lib/mashhad-flow-trial/.Xauthority -localhost -rfbport 5902 -nopw -forever -shared -quiet
MemoryMax=100M
UNIT
cat >> /etc/systemd/system/mashhad-flow-trial-novnc.service <<'UNIT'
[Unit]
After=mashhad-flow-trial-viewer.service
Requires=mashhad-flow-trial-viewer.service
[Service]
ExecStart=/usr/bin/websockify --web=/usr/share/novnc 127.0.0.1:6081 127.0.0.1:5902
MemoryMax=100M
UNIT
cat >> /etc/systemd/system/mashhad-flow-trial-gateway.service <<'UNIT'
[Unit]
After=mashhad-flow-trial-novnc.service
Requires=mashhad-flow-trial-novnc.service
[Service]
ExecStart=/usr/local/bin/node /opt/mashhad-flow-trial/server.mjs
MemoryMax=160M
UNIT
# Disable browser password saving through an account-specific Chrome preference.
runuser -u mashhad-trial -- mkdir -p /var/lib/mashhad-flow-trial/chrome-profile/Default
python3 - <<'PY'
import pathlib,json,pwd,os
p=pathlib.Path('/var/lib/mashhad-flow-trial/chrome-profile/Default/Preferences')
if not p.exists():
 p.write_text(json.dumps({'credentials_enable_service':False,'profile':{'password_manager_enabled':False}}))
 u=pwd.getpwnam('mashhad-trial');os.chown(p,u.pw_uid,u.pw_gid);os.chmod(p,0o600)
PY
systemctl daemon-reload
systemctl enable --now mashhad-flow-trial-{display,chrome,viewer,novnc,gateway}.service
python3 - <<'PY'
from pathlib import Path
p=Path('/etc/caddy/Caddyfile');text=p.read_text()
old='scan.iraqaistudio.com {\n    reverse_proxy 127.0.0.1:43135\n}'
new='''scan.iraqaistudio.com {
    redir /flow-trial /flow-trial/ 308
    handle /flow-trial/* {
        reverse_proxy 127.0.0.1:43136
    }
    handle {
        reverse_proxy 127.0.0.1:43135
    }
}'''
if new not in text:
 if text.count(old)!=1:raise SystemExit('Unexpected Caddy configuration; left unchanged')
 backup=p.with_name('Caddyfile.before-flow-trial');
 if not backup.exists():backup.write_text(text)
 p.with_name('Caddyfile.flow-trial-candidate').write_text(text.replace(old,new))
PY
if test -f /etc/caddy/Caddyfile.flow-trial-candidate; then
 caddy validate --config /etc/caddy/Caddyfile.flow-trial-candidate --adapter caddyfile
 cp /etc/caddy/Caddyfile.flow-trial-candidate /etc/caddy/Caddyfile
 systemctl reload caddy
fi
systemctl is-active mashhad-worker mashhad-chrome mashhad-flow-trial-{display,chrome,viewer,novnc,gateway}
