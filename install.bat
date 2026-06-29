@echo off
REM Install Contexta: Python venv + dependencies + web frontend build.
REM One of the three entry-point scripts:  install -> configure -> start
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 ( echo Node.js 18+ is required. Install it from https://nodejs.org and re-run install.bat & exit /b 1 )

if not exist .venv ( echo Creating virtual environment... & python -m venv .venv )
echo Installing Python dependencies...
call .venv\Scripts\pip install -r requirements.txt

if exist interface-web ( echo Building web frontend... & pushd interface-web & call npm install & call npm run build & popd )

echo.
echo Done. Run configure.bat then start.bat
