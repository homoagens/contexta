#!/bin/bash
# Install Contexta: Node (via nvm if missing) + Python venv + deps + frontend build.
# One of the three entry-point scripts:  install -> configure -> start
set -e
cd "$(dirname "$0")"

# ── 0. Normalise line endings + exec bits on shell scripts ───────────────────
#    (safe no-op on a clean clone; fixes repos cloned through Windows)
for f in configure.sh start.sh scripts/*.sh; do
    [ -f "$f" ] && sed -i 's/\r$//' "$f"
done
chmod +x configure.sh start.sh scripts/*.sh 2>/dev/null || true

# ── 1. Node.js >= 18 (install via nvm if missing) ────────────────────────────
NODE_MAJOR="$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1)"
if [ "${NODE_MAJOR:-0}" -lt 18 ] 2>/dev/null; then
    echo "Node.js >= 18 required (found: $(node --version 2>/dev/null || echo 'none')). Installing via nvm..."
    [ -f "$HOME/.nvm/nvm.sh" ] || curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    export NVM_DIR="$HOME/.nvm"
    . "$NVM_DIR/nvm.sh"
    nvm install 20 && nvm alias default 20 && nvm use 20
else
    echo "Node.js $(node --version) — OK"
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
fi

# ── 2. Python venv + dependencies ────────────────────────────────────────────
echo "Creating Python virtual environment (.venv)..."
[ -d .venv ] || python3 -m venv .venv
echo "Installing Python dependencies..."
./.venv/bin/pip install -r requirements.txt

# ── 3. Frontend build ────────────────────────────────────────────────────────
if [ -d interface-web ]; then
    echo "Building web frontend (interface-web)..."
    ( cd interface-web && npm install && npm run build )
fi

echo ""
echo "Done. Configure with ./configure.sh, then launch with ./start.sh"
