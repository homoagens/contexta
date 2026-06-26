#!/bin/bash
# Setup per deploy su server Linux.
# Controlla/installa Node.js >= 18 via nvm, poi esegue setup.sh.
#
# Bootstrap (se lo script ha CRLF da Windows):
#   sed -i 's/\r//' setup-server.sh setup.sh run_web.sh
#   chmod +x setup-server.sh && ./setup-server.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── 0. Node.js >= 18 ──────────────────────────────────────────────────────────
NODE_MAJOR="${NODE_MAJOR:-$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1)}"

if [ "${NODE_MAJOR:-0}" -lt 18 ] 2>/dev/null; then
    echo "Node.js >= 18 richiesto (trovato: $(node --version 2>/dev/null || echo 'non installato'))"
    echo "Installo Node.js 20 LTS via nvm..."

    if [ ! -f "$HOME/.nvm/nvm.sh" ]; then
        curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    fi

    export NVM_DIR="$HOME/.nvm"
    source "$NVM_DIR/nvm.sh"

    nvm install 20
    nvm alias default 20
    nvm use 20
    echo "Node.js $(node --version) installato."
else
    echo "Node.js $(node --version) — OK"
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
fi

# ── 1. .env: crea se mancante, imposta BACKEND_URL locale ─────────────────────
if [ ! -f "$SCRIPT_DIR/.env" ]; then
    cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
    echo ".env creato da .env.example"
fi
sed -i 's|^BACKEND_URL=.*|BACKEND_URL=http://127.0.0.1:8787|' "$SCRIPT_DIR/.env"
echo "BACKEND_URL → http://127.0.0.1:8787"

# ── 2. Setup standard (fix CRLF, venv, pip, npm install + build) ──────────────
"$SCRIPT_DIR/setup.sh"
echo "Setup server completato. Frontend in interface-web/dist/"
