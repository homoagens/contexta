#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── 0. CRLF → LF (necessario se i file vengono da Windows) ───────────────────
echo "Fix line endings (CRLF → LF)..."
find "$SCRIPT_DIR" \
    -not \( -path "*/.venv/*" -o -path "*/node_modules/*" -o -path "*/.git/*" \) \
    -type f \( \
        -name "*.py" -o -name "*.sh" -o -name "*.ts" -o -name "*.tsx" \
        -o -name "*.html" -o -name "*.json" -o -name "*.txt" \
        -o -name "*.md" -o -name ".env*" \
    \) \
    -exec sed -i 's/\r$//' {} \;

# ── 1. Permessi script shell ───────────────────────────────────────────────────
echo "Fix permessi .sh..."
find "$SCRIPT_DIR" -maxdepth 1 -name "*.sh" -exec chmod +x {} \;

# ── 2. Python venv + dipendenze ───────────────────────────────────────────────
echo "Creazione venv Python..."
python3 -m venv "$SCRIPT_DIR/.venv"

echo "Installazione dipendenze Python..."
"$SCRIPT_DIR/.venv/bin/pip" install -r "$SCRIPT_DIR/requirements.txt" --quiet
echo "Python OK."

# ── 3. Node / npm + build frontend ────────────────────────────────────────────
echo "Installazione dipendenze Node (interface-web)..."
cd "$SCRIPT_DIR/interface-web" && npm install --silent
cd "$SCRIPT_DIR/interface-web/node_modules" && chmod -R +x .bin/
cd "$SCRIPT_DIR/interface-web" && npm run build
cd "$SCRIPT_DIR"
echo "Node OK. Frontend in interface-web/dist/"

echo ""
echo "Fatto!"
echo ""
echo "  Copia .env.example in .env e inserisci le chiavi API."
echo ""
echo "  Per avviare:"
echo "    .venv/bin/python -m agent.run serve --port 8001"
echo ""
