"""Configuration loaded from environment variables / .env file."""
import os
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError as exc:  # pragma: no cover
    raise RuntimeError(
        "python-dotenv non è installato: il file .env verrebbe ignorato in "
        "silenzio e la configurazione (BACKEND_URL, porta, chiavi...) cadrebbe "
        "sui default. Installa le dipendenze:  pip install -r requirements.txt"
    ) from exc

load_dotenv()

# -- LLM backend URL (e.g. http://myhost:8787) --------------------------------
BACKEND_URL: str = os.environ.get("BACKEND_URL", "http://127.0.0.1:8787").rstrip("/")

# -- API key for the backend (accepts API_KEY, BACKEND_KEY, or KEY_FILE) -------
API_KEY: str = os.environ.get("API_KEY", "") or os.environ.get("BACKEND_KEY", "")
if not API_KEY:
    _key_file = os.environ.get("KEY_FILE", "")
    if _key_file:
        try:
            API_KEY = Path(_key_file).read_text().strip()
        except (FileNotFoundError, PermissionError):
            pass

# -- LLM provider selection ---------------------------------------------------
#   "local"     = self-hosted backend (default)
#   "anthropic" = Anthropic API (requires ANTHROPIC_API_KEY)
#   "openai"    = OpenAI API   (requires OPENAI_API_KEY)
LLM_PROVIDER: str = os.environ.get("LLM_PROVIDER", "local")

# Anthropic
ANTHROPIC_API_KEY: str = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL:   str = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6")

# OpenAI
OPENAI_API_KEY: str = os.environ.get("OPENAI_API_KEY", "")
OPENAI_MODEL:   str = os.environ.get("OPENAI_MODEL", "gpt-4o")

# Local model name (sent in the payload to the backend router)
LOCAL_MODEL_NAME: str = os.environ.get("LOCAL_MODEL_NAME", "qwen3.6-35b-a3b")

# Display name shown in the "Translated by ..." label
MODEL_DISPLAY_NAME: str = (
    ANTHROPIC_MODEL if LLM_PROVIDER == "anthropic"
    else OPENAI_MODEL if LLM_PROVIDER == "openai"
    else LOCAL_MODEL_NAME
)

# -- Auth & storage ------------------------------------------------------------
DB_FILE:           str  = os.environ.get("CONTEXTA_DB",       "/etc/contexta/contexta.db")
SESSION_TTL_DAYS:  int  = int(os.environ.get("SESSION_TTL_DAYS", "30"))
ADMIN_KEY:         str  = os.environ.get("ADMIN_KEY",          "")
ALLOW_REGISTRATION: bool = os.environ.get("ALLOW_REGISTRATION", "false").lower() == "true"

# -- Book storage --------------------------------------------------------------
BOOKS_DIR:      str = os.environ.get("BOOKS_DIR",      "/etc/contexta/books")
BOOKS_QUOTA_MB: int = int(os.environ.get("BOOKS_QUOTA_MB", "100"))

# -- Legacy (one-time JSON migration, can be removed after first deploy) -------
USERS_FILE: str = os.environ.get("USERS_FILE", "/etc/contexta/users.json")
