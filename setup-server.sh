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

# ── 1. .env: crea se mancante; NON sovrascrivere una BACKEND_URL già scelta ───
if [ ! -f "$SCRIPT_DIR/.env" ]; then
    cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
    echo ".env creato da .env.example"
fi
# Imposta il default locale solo se BACKEND_URL è assente o vuota,
# così rispettiamo la porta configurata con configure.sh.
if grep -qE '^BACKEND_URL=.+' "$SCRIPT_DIR/.env"; then
    echo "BACKEND_URL già impostata → $(grep -E '^BACKEND_URL=' "$SCRIPT_DIR/.env" | head -1 | cut -d= -f2-)"
elif grep -qE '^BACKEND_URL=' "$SCRIPT_DIR/.env"; then
    sed -i 's|^BACKEND_URL=.*|BACKEND_URL=http://127.0.0.1:8787|' "$SCRIPT_DIR/.env"
    echo "BACKEND_URL vuota → impostata default http://127.0.0.1:8787"
else
    printf 'BACKEND_URL=http://127.0.0.1:8787\n' >> "$SCRIPT_DIR/.env"
    echo "BACKEND_URL mancante → aggiunta default http://127.0.0.1:8787"
fi

# ── 2. Setup standard (fix CRLF, venv, pip, npm install + build) ──────────────
"$SCRIPT_DIR/setup.sh"
echo "Setup server completato. Frontend in interface-web/dist/"
