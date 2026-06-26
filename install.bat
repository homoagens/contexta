@echo off
REM Install Contexta: Python venv + dependencies + web frontend build.
cd /d "%~dp0"

if not exist .venv ( echo Creating virtual environment... & python -m venv .venv )
echo Installing Python dependencies...
call .venv\Scripts\pip install -r requirements.txt

if exist interface-web ( echo Building web frontend... & pushd interface-web & call npm install & call npm run build & popd )

echo.
echo Done. Run configure.bat then start.bat
