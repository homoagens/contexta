#!/bin/bash
# Installa contexta come servizio systemd.
# Uso: sudo ./scripts/install-service.sh
# Per disinstallare: sudo systemctl disable --now contexta && sudo rm /etc/systemd/system/contexta.service
set -e

SERVICE=contexta
PORT=8001
# Repo root is the parent of scripts/ — that's where .env and .venv live.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_USER="${SUDO_USER:-$(whoami)}"

cat > /etc/systemd/system/${SERVICE}.service << EOF
[Unit]
Description=${SERVICE} Agent Web Server
After=network.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${SCRIPT_DIR}
EnvironmentFile=${SCRIPT_DIR}/.env
ExecStart=${SCRIPT_DIR}/.venv/bin/python -m agent.run serve --port ${PORT}
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE}"
systemctl restart "${SERVICE}"

echo ""
echo "Servizio '${SERVICE}' installato su http://0.0.0.0:${PORT}"
echo ""
echo "Comandi utili:"
echo "  systemctl status ${SERVICE}"
echo "  journalctl -u ${SERVICE} -f     # log in tempo reale"
echo "  systemctl restart ${SERVICE}"
echo "  systemctl stop ${SERVICE}"
