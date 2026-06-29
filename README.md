<h2 align="center">📖 Contexta</h2>

<p align="center">
  <em>Read books in a foreign language. Tap any word. Understand it in context.</em>
</p>

<p align="center">
  Context-aware translation  ·  Per-book knowledge base  ·  Spaced-repetition vocabulary  ·  Powered by your own LLM
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-e67e22?style=flat-square" alt="License"></a>
  <img src="https://img.shields.io/badge/python-3.11%2B-3776ab?style=flat-square" alt="Python 3.11+">
  <img src="https://img.shields.io/badge/frontend-React%20%2B%20TS%20%2B%20Vite-61dafb?style=flat-square" alt="React + TS + Vite">
  <img src="https://img.shields.io/badge/PWA-installable-5a0fc8?style=flat-square" alt="PWA">
  <img src="https://img.shields.io/badge/langs-EN·IT·ES·DE·FR-43a047?style=flat-square" alt="Languages">
</p>

---

**An AI-native EPUB reader for language learners.** Read in a foreign language and tap any word for an instant, context-aware translation — powered by *your own* local LLM, with no per-word cost and no data leaving your server.

Contexta goes beyond a dictionary: it understands the *sentence* a word appears in, builds a per-book knowledge base you can chat with, remembers the words you struggle with, and turns your saved vocabulary into spaced-repetition flashcards.

Supported pairs: **EN · IT · ES · DE · FR** (plus same-language "synonym mode" for vocabulary expansion).

---

## ✦ Features

- **🎯 Context-aware translation** — tap a word and the model translates *that sense* in *that sentence*, not a generic dictionary entry. Returns the best translation, alternatives, part of speech, and an improved example.
- **⚡ Streaming output** — translations stream token-by-token when the backend supports SSE.
- **🗄 Two-level cache** — every translation is cached (context-free + context-sensitive). A second tap on the same word is instant.
- **🔮 Anticipatory translation** — on each page turn, the page's words are pre-translated in the background so subsequent taps hit a warm cache.
- **📚 Per-book knowledge base** — on open, Contexta extracts chapters and builds a spoiler-safe summary, theme list, and character index.
- **💬 Reading companion** — chat about the book grounded in its knowledge base, clipped to your current position so nothing ahead is spoiled. A "speak as the book" persona mode is included.
- **📈 Vocabulary profile** — the words you look up most are tracked and used to prioritise predictive glossing.
- **🃏 Spaced-repetition glossary** — saved words become SM-2 flashcards; the reader surfaces a review session when cards are due.
- **🛡 Multilingual hallucination guard** — a deterministic validator catches invented words (per-language phonotactics + optional spellcheck) and forces a retry, keeping small local models honest.
- **📕 Two reading engines** — the stable classic engine (epub.js) and an opt-in engine (foliate-js) with more accurate progress tracking.
- **🔒 Local-first & private** — books and saved words live in the browser (IndexedDB); only the selected word + its sentence is sent to your server. Installable as a PWA.

---

## 🏗 Architecture

```
Browser (PWA / iOS home screen)
    │  HTTP  (port 8001)
    ▼
Agent  ──── also serves the built frontend (dist/)
(FastAPI / uvicorn, port 8001)
    │  HTTP  POST /v1/chat/completions  (OpenAI-compatible, URL set in configure)
    ▼
LLM backend
(local inference server — e.g. llama.cpp, vLLM, Ollama, LM Studio —
 or Anthropic / OpenAI API)
```

A single Python process exposes both the API and the static frontend. The LLM backend is a separate external service (not included).

The agent follows a **skill-dispatch** pattern: each HTTP endpoint routes to a self-contained skill (`translate`, `chat`, `analyze`, `book_chat`, `batch_translate`) that owns its own prompts, retry loop, and validation. For the `local` provider it talks to any OpenAI-compatible `/chat/completions` endpoint; an optional deterministic dictionary lookup (`/tools/lookup`) is used when the backend exposes it.

<details>
<summary>Project layout</summary>

```
contexta/
├── agent/                     # Python backend (FastAPI)
│   ├── server.py              # HTTP endpoints
│   ├── agent.py               # skill dispatcher
│   ├── config.py              # environment loading
│   ├── db.py                  # shared SQLite connection
│   ├── auth.py                # users + sessions (PBKDF2)
│   ├── books.py               # book storage + reading position
│   ├── book_kb.py             # per-book knowledge base store
│   ├── translation_cache.py   # two-level translation cache
│   ├── vocab.py               # vocabulary profile
│   ├── validator.py           # hallucination detection
│   ├── prompts.py             # all LLM prompts (English)
│   ├── schemas.py             # input/output dataclasses
│   ├── skills/                # translate, chat, batch, analyze, book_chat
│   └── tools/client.py        # HTTP client to the LLM backend (+ streaming)
├── interface-web/             # React + TypeScript + Vite frontend
│   ├── src/
│   │   ├── components/        # Reader, TranslationPanel, Library, Favorites…
│   │   ├── foliate/           # vendored foliate-js engine
│   │   ├── store/             # IndexedDB + SRS scheduling
│   │   └── api/               # backend clients
│   └── dist/                  # production build (npm run build)
├── manage.sh                  # user/session admin console
├── requirements.txt
├── .env.example
└── LICENSE                    # MIT
```

</details>

---

## ⚡ Quickstart

**Prerequisites:** Python 3.11+, Node.js 18+ and npm, and an LLM endpoint reachable over HTTP (any OpenAI-compatible server — Ollama, LM Studio, llama.cpp, vLLM — or an Anthropic / OpenAI API key).

The entire setup is **three scripts, run in order**. Each has a `.sh` (Linux/macOS) and a `.bat` (Windows) twin — pick the one for your OS and the pipeline is identical everywhere.

```bash
# 1. Install — creates the Python venv, installs deps, builds the frontend
./install.sh                 #  Windows:  install.bat

# 2. Configure — interactive prompts; writes your .env
./configure.sh               #  Windows:  configure.bat

# 3. Start — launches the server on :8001 and opens your browser
./start.sh                   #  Windows:  start.bat
```

That's it. Open `http://localhost:8001` (step 3 opens it for you). On first run (no users yet) the login form shows **"Create account"**.

> When **configure** asks for the *Backend URL*, give the **base URL ending in `/v1`** (the agent calls `/v1/chat/completions`), e.g. `http://127.0.0.1:8000/v1`, or LM Studio's `http://127.0.0.1:1234/v1`.

Re-run any step independently later: `configure` to point at a different model/endpoint, `install` after pulling frontend changes, `start` to relaunch. To stop the service, use the **⏻ Quit** button in the app's Settings (or `Ctrl-C` in the terminal).

<details>
<summary>Manual / development setup (hot-reload)</summary>

```bash
pip install -r requirements.txt       # + `anthropic` or `openai` for those providers
./configure.sh                        # write .env
cd interface-web && npm run dev &     # frontend on :5173 (Vite proxy → :8001)
cd .. && python -m agent.run serve    # agent on :8001
```

</details>

---

## 🔌 Configuration

Key variables in `.env` (see `.env.example` for the full list):

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | `local` | `local` / `anthropic` / `openai` |
| `BACKEND_URL` | `http://127.0.0.1:8000/v1` | OpenAI-compatible base URL (ends in `/v1`) |
| `API_KEY` | — | Bearer key for the local backend |
| `LOCAL_MODEL_NAME` | `qwen3.6-35b-a3b` | Model name sent to the backend router |
| `ANTHROPIC_API_KEY` | — | Required if `LLM_PROVIDER=anthropic` |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | Anthropic model id |
| `OPENAI_API_KEY` | — | Required if `LLM_PROVIDER=openai` |
| `OPENAI_MODEL` | `gpt-4o` | OpenAI model id |
| `CONTEXTA_DB` | `/etc/contexta/contexta.db` | SQLite database path |
| `BOOKS_DIR` | `/etc/contexta/books` | EPUB storage directory |
| `BOOKS_QUOTA_MB` | `100` | Per-user upload quota |
| `SESSION_TTL_DAYS` | `30` | Session lifetime |
| `ADMIN_KEY` | — | Enables the HTTP admin API (optional) |

> **Note on local models:** Contexta is tuned for instruction-following models that return structured JSON. For reasoning models (e.g. Qwen3), a model-agnostic system-prompt hint keeps translation latency low without vendor-specific tokens, and any reasoning the model still emits is streamed live to the UI rather than hidden.

---

## 🚀 Deployment

```bash
# 1. Build the frontend locally
cd interface-web && npm run build

# 2. Sync to the server
rsync -av dist/ user@server:/opt/contexta/interface-web/dist/

# 3. Restart
ssh user@server "systemctl restart contexta"
```

<details>
<summary>Example systemd unit</summary>

```ini
# /etc/systemd/system/contexta.service
[Unit]
Description=Contexta Agent
After=network.target

[Service]
WorkingDirectory=/opt/contexta
EnvironmentFile=/opt/contexta/.env
ExecStart=/usr/bin/python3 -m agent.run serve --port 8001
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

</details>

---

## 👤 User management

`manage.sh` runs **on the server** and talks directly to the SQLite database, independently of the web service:

```bash
bash manage.sh                              # interactive menu
bash manage.sh users list
bash manage.sh users create <username>
bash manage.sh users disable <username>     # block access without deleting
bash manage.sh users reset-password <username>
bash manage.sh sessions purge               # drop expired sessions
```

If `ADMIN_KEY` is set, the same actions are available over HTTP via the `X-Admin-Key` header (`/admin/users`, `/admin/sessions`, …).

---

## 🔐 Data & privacy

| Stored where | What |
|--------------|------|
| Browser (IndexedDB) | books, reading position, highlights, saved words (SRS), UI settings |
| Server SQLite (`CONTEXTA_DB`) | users, sessions, translation cache, per-book KB, vocabulary profile |
| Server (`BOOKS_DIR`) | uploaded EPUB files |

Only the selected word and its surrounding sentence are sent to the server for translation. Reading position syncs so you can resume on another device.

Deleting the SQLite file is non-destructive to your books (they live in `BOOKS_DIR`) — tables are recreated empty on next start, and you simply re-register.

---

## 🌱 Part of Homo Agens

Contexta is part of **[Homo Agens](https://github.com/homoagens)** — an open-source effort exploring autonomous agents, local inference, and a simple thesis:

> The model matters less than the architecture around it.
> Memory, tools, transparency, and execution control are what turn an LLM into something that actually gets things done.

---

## 📬 Contact

If you work on agents, local AI, open-source tooling, or language learning — let's talk.

[Email](mailto:homoagens1@gmail.com) &nbsp;·&nbsp; [X / Twitter](https://x.com/homoagens1)

---

## License

[MIT](./LICENSE) © 2026 homoagens
