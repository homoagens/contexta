# Contexta — Architecture Reference

> Contextual translation agent for EPUB readers.
> Pattern B: direct skill dispatch (no ReAct loop).

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (React + epub.js)                                      │
│  ┌───────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │  Library   │  │   Reader     │  │  TranslationPanel        │  │
│  │  (books)   │  │   (epub.js)  │  │  (results + chat)        │  │
│  └─────┬─────┘  └──────┬───────┘  └───────────┬──────────────┘  │
│        └───────────┬────┘                      │                │
│                    ▼                           │                │
│             REST API calls                      │                │
└────────────────────┬───────────────────────────┘                │
                     │  HTTP/JSON                                  │
                     ▼                                             │
┌─────────────────────────────────────────────────────────────────┐
│  Agent (Python / FastAPI)                       port 8001       │
│  ┌──────────┐  ┌──────────┐  ┌────────┐  ┌──────────────────┐  │
│  │ server.py│→ │ agent.py │→ │ skills │→ │ tools/client.py  │  │
│  │ (HTTP)   │  │ (router) │  │        │  │ (LLM abstraction)│  │
│  └──────────┘  └──────────┘  └────┬───┘  └────────┬─────────┘  │
│                                   │               │             │
│                              ┌────▼───┐     ┌─────▼──────┐     │
│                              │validate│     │  prompts.py │     │
│                              │  _json │     │  (templates)│     │
│                              └────────┘     └────────────┘     │
├─────────────────────────────────────────────────────────────────┤
│  Storage: SQLite (WAL) + filesystem                             │
│  ┌─────────┐  ┌───────────────┐  ┌────────────────────────┐    │
│  │ auth.py │  │   books.py    │  │  /etc/contexta/books/  │    │
│  │ (users, │  │ (metadata,    │  │  (EPUB files on disk)  │    │
│  │ sessions│  │  positions)   │  │                        │    │
│  └────┬────┘  └───────┬───────┘  └────────────────────────┘    │
│       └───────┬───────┘                                         │
│          ┌────▼────┐                                            │
│          │  db.py  │  ← shared connection helper                │
│          └────┬────┘                                            │
│               ▼                                                 │
│         contexta.db                                             │
└─────────────────────────────────────────────────────────────────┘
                     │
                     │  HTTP/JSON
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  LLM Backend (interchangeable)                                  │
│                                                                 │
│  Option A: Self-hosted    POST /llm     (gemma3-12b, port 8787) │
│  Option B: Anthropic API  messages.create (claude-*)            │
│  Option C: OpenAI API     completions.create (gpt-*)            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Request Lifecycle

### Translation request (full trace)

```
1. User selects "manifest" in the EPUB reader
2. Browser sends:
   POST /translate
   Authorization: Bearer <token>
   {"selected_span": "manifest", "target_sentence": "Time is manifest in...",
    "source_lang": "en", "target_lang": "it"}

3. server.py
   ├─ require_auth() → validates token against sessions table
   ├─ TranslateRequest.resolve() → input validation (max 5 words)
   └─ agent.run("translate", data)

4. agent.py
   ├─ Looks up "translate" in skill registry
   ├─ Builds TranslateInput dataclass (typed validation)
   └─ Calls TranslateSkill.run(input, client)

5. TranslateSkill (skills/translate.py)
   ├─ Step 1: client.lookup("manifest", "en", "it")
   │          → POST /tools/lookup on backend
   │          → Returns WordNet hints: {target_lemmas: ["manifesto", "evidente"]}
   │
   ├─ Step 2: build_translate_messages_with_hints(payload, hints, "en", "it")
   │          → Returns [system_msg, user_msg]
   │
   ├─ Step 3: client.llm(messages, temperature=0.1, json_mode=True)
   │          → Dispatches to local/anthropic/openai based on LLM_PROVIDER
   │          → Model returns: '{"best_result":"manifesto","span_role":"ADJ",...}'
   │
   ├─ Step 4: parse_json_object(response)
   │          → Extracts JSON from potentially messy output
   │          → Falls back through: direct parse → fix fences → brace match
   │
   ├─ Step 5: has_hallucinated_word("manifesto", "it")
   │          → Spell-check + impossible consonant cluster detection
   │          → Returns False (word is valid)
   │
   └─ Step 6: Build TranslateOutput → return to agent → to_dict() → JSON response

6. Browser receives:
   {"best_result": "manifesto", "span_role": "ADJ",
    "span_sense": "evidente, visibile ai sensi",
    "alternatives": ["palese"], "improved_sentence": "Il tempo è manifesto in..."}
```

---

## 3. File-by-File Reference

### Core Pipeline

| File | Role | Key function |
|------|------|-------------|
| `server.py` | HTTP layer | FastAPI endpoints, auth guards, request validation |
| `agent.py` | Router | `run(skill_name, data)` → dispatches to skill |
| `skills/translate.py` | Domain logic | Lookup → prompt → LLM → parse → validate → retry |
| `skills/chat.py` | Follow-up Q&A | Builds context from translation result, calls LLM |
| `tools/client.py` | LLM abstraction | `llm()` → local / Anthropic / OpenAI |
| `prompts.py` | Prompt templates | System + user message builders for all modes |
| `_json.py` | Response parser | Extracts JSON from messy LLM output |
| `validator.py` | Quality gate | Hallucination detection via spellcheck |
| `schemas.py` | Data contracts | Typed input/output dataclasses |

### Infrastructure

| File | Role |
|------|------|
| `config.py` | Environment variable loading |
| `db.py` | Shared SQLite connection (WAL mode) |
| `auth.py` | Users, passwords (PBKDF2), sessions, admin ops |
| `books.py` | EPUB storage, reading positions, quota enforcement |
| `run.py` | CLI entry point (`python -m agent.run serve`) |
| `manage.py` | Admin CLI (`manage.sh` wrapper) |

---

## 4. LLM Call Anatomy

Every LLM interaction follows this exact structure:

### Message format

```python
messages = [
    {"role": "system", "content": "<instructions + output format>"},
    {"role": "user",   "content": "<data as JSON string>"},
]
```

### System prompt design rules

1. **State the role** first: "You are an English-to-Italian translator."
2. **Define the output format** explicitly: "Output ONLY a raw JSON object"
3. **List required keys** and their constraints
4. **Reference input fields by name**: "the value in the 'span' field"
   (never use field names as English words — models may interpret literally)
5. **Show the output skeleton**: `{"best_result":"...","span_role":"..."}`

### Client abstraction

```python
text = await client.llm(
    messages,
    temperature=0.1,     # low = deterministic (good for structured output)
    top_p=0.9,           # nucleus sampling
    max_tokens=2048,     # response length limit
    json_mode=True,      # force JSON output (if provider supports it)
    model_override="",   # per-request model switch
)
```

The `client.llm()` method routes to the correct provider:

| Provider | Transport | Auth |
|----------|-----------|------|
| `local` | `POST /llm` to self-hosted backend | Bearer token |
| `anthropic` | `anthropic.AsyncAnthropic.messages.create()` | API key |
| `openai` | `openai.AsyncOpenAI.chat.completions.create()` | API key |

Switching provider requires only changing `LLM_PROVIDER` in `.env`.

---

## 5. Retry Strategy

The skill runs up to `max_retries` attempts (default: 2).

```
Attempt 1:  Standard prompt + hints (if lookup succeeded)
            temperature = 0.1
                ↓ fail?
Attempt 2:  Adapted prompt:
            - If response was empty → minimal prompt (shorter, simpler)
            - If response had errors → same prompt with hints added
            temperature = 0.15 (bump +0.05 per retry)
                ↓ fail?
            → RuntimeError raised
```

### Parse resilience

The JSON parser handles real-world LLM output:

1. **Direct parse** — clean JSON
2. **Fix fences** — strips ` ```json ... ``` ` wrappers
3. **Fix trailing commas** — `{"a":1,}` → `{"a":1}`
4. **Brace matching** — extracts `{...}` from surrounding prose
5. **Flexible key names** — accepts `best_result`, `translation`, `result`, `word`, etc.

### Hallucination detection

After parsing, `validator.py` checks the main result:

```python
def has_hallucinated_word(word, target_lang):
    # 1. Check against language dictionary (pyspellchecker)
    # 2. Check for impossible consonant clusters
    #    e.g. Italian cannot have "bkr", "fgz", "tpz"
    # If BOTH fail → hallucination suspected → retry
```

---

## 6. Authentication

```
Register → PBKDF2(password, random_salt, 200k iterations) → users table
Login    → verify hash → create session token (32 bytes, urlsafe) → sessions table
Request  → Bearer token → validate_token() → username or 401
```

- Sessions expire after `SESSION_TTL_DAYS` (default 30)
- Admin operations require `X-Admin-Key` header
- Registration can be locked via `ALLOW_REGISTRATION=false`

---

## 7. Book Storage & Position Sync

```
Upload:   Browser → POST /books (multipart) → SHA-256 ID → filesystem + SQLite
Download: Browser → GET /books/{id}/file → FileResponse (epub+zip)
Position: Browser → PUT /books/{id}/position {cfi, progress}
                    → SQLite UPSERT (reading_positions table)
Restore:  Browser → GET /books/{id}/position → {cfi, progress}
                    → epub.js rendition.display(cfi)
```

### Cross-device sync flow

```
Device A reads to page 50:
  1. epub.js 'relocated' event → readingStateRef updated
  2. After 1s debounce → PUT /books/{id}/position {cfi, progress: 23}
  3. User taps back → handleClose() awaits savePosition() → server confirmed
  4. Library reloads → GET /books → last_progress: 23 → progress bar shown

Device B opens same book:
  1. openServerBook() → GET /books/{id}/position → {cfi: "epubcfi(...)", progress: 23}
  2. updateLastCfi() → IndexedDB updated
  3. Reader → rendition.display(cfi) → resumes at page 50
```

### Progress calculation

```
epub.js locations.generate(1600) runs in background after initial display.
Before completion: progress display shows "…"
After completion:  relocated events carry accurate percentage (0–100)
                   → saved to server immediately
                   → subsequent page turns update in real-time
```

---

## 8. Configuration

All configuration is via environment variables (loaded from `.env`):

| Variable | Default | Purpose |
|----------|---------|---------|
| `LLM_PROVIDER` | `local` | `local` / `anthropic` / `openai` |
| `BACKEND_URL` | `http://127.0.0.1:8787` | Local LLM backend URL |
| `BACKEND_KEY` | — | API key for local backend |
| `LOCAL_MODEL_NAME` | `gemma3-12b` | Model name sent to backend router |
| `ANTHROPIC_API_KEY` | — | Anthropic API key |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | Anthropic model ID |
| `OPENAI_API_KEY` | — | OpenAI API key |
| `OPENAI_MODEL` | `gpt-4o` | OpenAI model ID |
| `CONTEXTA_DB` | `/etc/contexta/contexta.db` | SQLite database path |
| `SESSION_TTL_DAYS` | `30` | Session expiry |
| `ADMIN_KEY` | — | Admin API key |
| `ALLOW_REGISTRATION` | `false` | Allow new user signups |
| `BOOKS_DIR` | `/etc/contexta/books` | EPUB file storage path |
| `BOOKS_QUOTA_MB` | `100` | Per-user storage quota |

---

## 9. API Endpoints

### Public

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/check_first_run` | True if no users exist |
| POST | `/login` | `{username, password}` → `{token}` |
| POST | `/register` | Create user (if allowed) |
| POST | `/logout` | Revoke session token |

### Authenticated (Bearer token)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/me` | Current user info |
| GET | `/health` | Agent + backend status |
| POST | `/translate` | Translate or synonym request |
| POST | `/chat_context` | Follow-up Q&A on translation |
| GET | `/books` | List user's books (with progress) |
| POST | `/books` | Upload EPUB (multipart) |
| DELETE | `/books/{id}` | Delete book |
| GET | `/books/{id}/file` | Download EPUB |
| PUT | `/books/{id}/position` | Save reading position |
| GET | `/books/{id}/position` | Get reading position |
| GET | `/books/quota` | Storage quota info |

### Admin (X-Admin-Key header)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/admin/users` | List all users |
| DELETE | `/admin/users/{u}` | Delete user |
| POST | `/admin/users/{u}/disable` | Disable user |
| POST | `/admin/users/{u}/enable` | Enable user |
| POST | `/admin/users/{u}/reset-password` | Reset password |
| GET | `/admin/sessions` | List active sessions |
| DELETE | `/admin/sessions/{u}` | Revoke user sessions |
| POST | `/admin/sessions/purge` | Clean expired sessions |

---

## 10. Design Decisions

### Why Pattern B (direct dispatch) instead of ReAct

ReAct agents loop: think → act → observe → think → ... This adds latency and unpredictability. Contexta's task is well-defined (translate one phrase), so:

- **Direct dispatch**: one LLM call per request (+ optional retry)
- **Deterministic pre-processing**: dictionary lookup before the LLM call
- **Deterministic post-processing**: JSON parse + hallucination check after

Result: ~200ms latency per translation (local model), predictable behavior.

### Why SQLite, not Postgres

- Single-file deployment, zero configuration
- WAL mode handles concurrent reads from multiple processes
- Sufficient for hundreds of concurrent users
- No separate database service to manage

### Why three LLM providers

- **Local** (default): free, private, fast on GPU hardware
- **Anthropic**: highest quality for complex translations
- **OpenAI**: widely available, good JSON mode support

The switch is a single env var. Code is identical across providers.

### Why retry with adapted prompts

Small local models (7B–12B parameters) fail ~10% of requests:
- Malformed JSON (missing closing brace, markdown fences)
- Wrong field names (model invents its own schema)
- Hallucinated words (nonsense that looks like the target language)

Two retries with temperature bump + prompt simplification recover most failures.

---

## 11. Deployment

```bash
# Install
cd contexta
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Configure
cp .env.example .env
# Edit: LLM_PROVIDER, BACKEND_URL, BACKEND_KEY, CONTEXTA_DB, etc.

# Build frontend
cd interface-web && npm ci && npm run build && cd ..

# Run
python -m agent.run serve --port 8001

# Production (systemd)
sudo systemctl enable contexta
sudo systemctl start contexta
```

### Two-instance setup (dev + stable)

```
/opt/contexta/         → port 8001 (development)
/opt/contexta_stable/  → port 8002 (production)

Each has its own .env with separate CONTEXTA_DB and BOOKS_DIR.
```
