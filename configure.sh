#!/bin/bash
cd "$(dirname "$0")"

echo ""
echo "========================================"
echo "  Contexta - LLM configuration"
echo "========================================"
echo ""
echo "This will write a .env file for Contexta."
echo "Point it at any OpenAI-compatible endpoint"
echo "(Ollama, LM Studio, vLLM, llama.cpp, OpenAI, Groq, OpenRouter...)."
echo ""

read -p "Backend URL [http://127.0.0.1:8787]: " BASE_URL
BASE_URL=${BASE_URL:-http://127.0.0.1:8787}

read -p "Model name [qwen3.6-35b-a3b]: " MODEL
MODEL=${MODEL:-qwen3.6-35b-a3b}

read -p "API key (press Enter for none): " API_KEY

read -p "Database path [./contexta.db]: " DB_FILE
DB_FILE=${DB_FILE:-./contexta.db}

read -p "Books directory [./books]: " BOOKS_DIR
BOOKS_DIR=${BOOKS_DIR:-./books}

if [ -f .env ]; then
    cp .env .env.backup
    echo ""
    echo "Existing .env backed up to .env.backup"
fi

cat > .env <<EOF
LLM_PROVIDER=local
BACKEND_URL=${BASE_URL}
API_KEY=${API_KEY}
LOCAL_MODEL_NAME=${MODEL}

CONTEXTA_DB=${DB_FILE}
BOOKS_DIR=${BOOKS_DIR}
SESSION_TTL_DAYS=30
EOF

echo ""
echo "Configuration saved to .env:"
echo "  provider:    local (openai-compatible)"
echo "  backend URL: ${BASE_URL}"
echo "  model:       ${MODEL}"
echo "  database:    ${DB_FILE}"
echo "  books dir:   ${BOOKS_DIR}"
echo ""
