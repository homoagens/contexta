#!/bin/bash
# Launch Contexta (FastAPI/uvicorn on port 8001) and open the browser.
cd "$(dirname "$0")"
( sleep 2 && { xdg-open http://localhost:8001 2>/dev/null || open http://localhost:8001 2>/dev/null; } ) &
./.venv/bin/python -m agent.run serve --port 8001
