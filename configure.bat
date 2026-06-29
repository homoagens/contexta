@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo ========================================
echo   Contexta - LLM configuration
echo ========================================
echo.
echo This will write a .env file for Contexta.
echo Point it at any OpenAI-compatible endpoint
echo (Ollama, LM Studio, vLLM, llama.cpp, OpenAI, Groq, OpenRouter...).
echo.
echo Enter the BASE url, ending in /v1 (the client calls /v1/chat/completions).
echo   e.g. http://127.0.0.1:8000/v1   LM Studio: http://127.0.0.1:1234/v1
echo.

set "DEFAULT_URL=http://127.0.0.1:8000/v1"
set "DEFAULT_MODEL=qwen3.6-35b-a3b"

set /p BASE_URL=Backend URL [%DEFAULT_URL%]:
if "!BASE_URL!"=="" set "BASE_URL=%DEFAULT_URL%"

set /p MODEL=Model name [%DEFAULT_MODEL%]:
if "!MODEL!"=="" set "MODEL=%DEFAULT_MODEL%"

set /p API_KEY=API key (press Enter for none):

set /p DB_FILE=Database path [./contexta.db]:
if "!DB_FILE!"=="" set "DB_FILE=./contexta.db"

set /p BOOKS_DIR=Books directory [./books]:
if "!BOOKS_DIR!"=="" set "BOOKS_DIR=./books"

if exist .env (
    copy /Y .env .env.backup >nul
    echo.
    echo Existing .env backed up to .env.backup
)

(
    echo LLM_PROVIDER=local
    echo BACKEND_URL=!BASE_URL!
    echo API_KEY=!API_KEY!
    echo LOCAL_MODEL_NAME=!MODEL!
    echo.
    echo CONTEXTA_DB=!DB_FILE!
    echo BOOKS_DIR=!BOOKS_DIR!
    echo SESSION_TTL_DAYS=30
) > .env

echo.
echo Configuration saved to .env:
echo   provider:    local (openai-compatible)
echo   backend URL: !BASE_URL!
echo   model:       !MODEL!
echo   database:    !DB_FILE!
echo   books dir:   !BOOKS_DIR!
echo.
endlocal
