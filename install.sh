#!/bin/bash
# Install Contexta: Python venv + dependencies + web frontend build.
set -e
cd "$(dirname "$0")"

echo "Creating Python virtual environment (.venv)..."
[ -d .venv ] || python3 -m venv .venv

echo "Installing Python dependencies..."
./.venv/bin/pip install -r requirements.txt

if [ -d interface-web ]; then
    echo "Building web frontend (interface-web)..."
    ( cd interface-web && npm install && npm run build )
fi

echo ""
echo "Done. Configure with ./configure.sh, then launch with ./start.sh"
