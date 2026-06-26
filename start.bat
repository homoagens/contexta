@echo off
REM Launch Contexta (port 8001) and open the browser.
cd /d "%~dp0"
start "" http://localhost:8001
.venv\Scripts\python -m agent.run serve --port 8001
