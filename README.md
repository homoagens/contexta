<h2 align="center">📖 Contexta</h2>

<p align="center">
  <em>Read books in a foreign language. Tap any word. Understand it in context.</em>
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-e67e22?style=flat-square" alt="License"></a>
  <img src="https://img.shields.io/badge/python-3.11%2B-3776ab?style=flat-square" alt="Python 3.11+">
  <img src="https://img.shields.io/badge/langs-EN·IT·ES·DE·FR-43a047?style=flat-square" alt="Languages">
</p>

---

**An AI-native EPUB reader for language learners.** Tap any word for an instant, context-aware translation — powered by *your own* OpenAI-compatible LLM, with no per-word cost and nothing leaving your server. Contexta understands the *sentence* a word lives in, builds a per-book knowledge base you can chat with, and turns the words you struggle with into spaced-repetition flashcards.

Supported pairs: **EN · IT · ES · DE · FR** (plus same-language "synonym mode").

---

## ✦ Features

- **🎯 Context-aware translation** — translates *that sense* in *that sentence*, with alternatives, part of speech, and an improved example.
- **⚡ Streaming** — answers stream live (including the model's reasoning, if any); the raw JSON is never shown.
- **🗄 Two-level cache + anticipatory translation** — repeat taps are instant; each page is pre-translated in the background.
- **📚 Per-book knowledge base** — spoiler-safe summary, themes, and character index you can chat with, clipped to your reading position.
- **🃏 Vocabulary & SRS** — looked-up words feed a profile and become SM-2 flashcards.
- **🛡 Hallucination guard** — a deterministic validator catches invented words and forces a retry, keeping small models honest.
- **🔒 Local-first & private** — books and saved words live in the browser (IndexedDB); only the word + its sentence is sent to your server. Installable as a PWA.

---

## ⚡ Quickstart

**Prerequisites:** Python 3.11+, Node.js 18+ and npm, and an OpenAI-compatible LLM endpoint (Ollama, LM Studio, llama.cpp, vLLM, …).

Setup is **three scripts, run in order**. Each has a `.sh` (Linux/macOS) and a `.bat` (Windows) twin — same pipeline everywhere.

```bash
./install.sh      # 1. venv + deps + frontend build      (Windows: install.bat)
./configure.sh    # 2. interactive prompts → writes .env  (Windows: configure.bat)
./start.sh        # 3. launch on :8001 + open browser     (Windows: start.bat)
```

Open `http://localhost:8001` (step 3 opens it for you). On first run the login form shows **"Create account"**.

> When **configure** asks for the *Backend URL*, give the **base URL ending in `/v1`** (the agent calls `/v1/chat/completions`) — e.g. `http://127.0.0.1:8000/v1`, or LM Studio's `http://127.0.0.1:1234/v1`.

Re-run any step independently: `configure` to switch model/endpoint, `install` after frontend changes, `start` to relaunch. Stop the service with the **⏻ Quit** button in the app (or `Ctrl-C`).

---

## 🏗 Architecture

```
Browser (PWA)
    │  HTTP  :8001
    ▼
Agent (FastAPI / uvicorn)  ── also serves the built frontend (dist/)
    │  POST {BACKEND_URL}/chat/completions   (OpenAI-compatible)
    ▼
Your LLM server  (llama.cpp · vLLM · Ollama · LM Studio · …)
```

A single Python process exposes both the API and the static frontend. The LLM server is external (not included). Each endpoint routes to a self-contained **skill** (`translate`, `chat`, `analyze`, `book_chat`, `batch_translate`) that owns its prompts, retry loop, and validation.

<details>
<summary>Project layout</summary>

```
contexta/
├── agent/                     # Python backend (FastAPI)
│   ├── server.py              # HTTP endpoints
│   ├── agent.py               # skill dispatcher
│   ├── config.py              # environment loading
│   ├── skills/                # translate, chat, batch, analyze, book_chat
│   └── tools/client.py        # OpenAI-compatible LLM client (+ streaming)
├── interface-web/             # React + TypeScript + Vite frontend
│   └── dist/                  # production build (npm run build)
├── install.sh / configure.sh / start.sh   (+ .bat twins)   # the pipeline
├── scripts/                   # ops: manage.sh (admin), install-service.sh (systemd)
├── requirements.txt
└── .env.example
```

</details>

---

## 🔌 Configuration

`configure` writes these into `.env` (see `.env.example` for the full list):

| Variable | Example | Description |
|----------|---------|-------------|
| `BACKEND_URL` | `http://127.0.0.1:8000/v1` | OpenAI-compatible base URL (ends in `/v1`) |
| `API_KEY` | — | Bearer key for the backend (optional) |
| `LOCAL_MODEL_NAME` | `qwen3.6-35b-a3b` | Model name sent in the request |
| `CONTEXTA_DB` | `./contexta.db` | SQLite database path |
| `BOOKS_DIR` | `./books` | EPUB storage directory |
| `BOOKS_QUOTA_MB` | `100` | Per-user upload quota |
| `SESSION_TTL_DAYS` | `30` | Session lifetime |
| `ADMIN_KEY` | — | Enables the HTTP admin API (optional) |

> **Reasoning models (e.g. Qwen3):** a model-agnostic system-prompt hint keeps translation latency low without vendor-specific tokens, and any reasoning the model emits is streamed live to the UI.

---

## 🚀 Deployment

On the server, run the pipeline (`./install.sh && ./configure.sh`), then register the systemd service with one command:

```bash
sudo ./scripts/install-service.sh        # creates + enables + starts contexta.service
```

To redeploy just the frontend afterwards:

```bash
cd interface-web && npm run build
rsync -av dist/ user@server:/opt/contexta/interface-web/dist/
ssh user@server "systemctl restart contexta"
```

<details>
<summary>Equivalent systemd unit (if you prefer to write it by hand)</summary>

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

`scripts/manage.sh` runs **on the server** and talks directly to the SQLite database:

```bash
bash scripts/manage.sh                              # interactive menu
bash scripts/manage.sh users create <username>
bash scripts/manage.sh users disable <username>     # block without deleting
bash scripts/manage.sh users reset-password <username>
bash scripts/manage.sh sessions purge               # drop expired sessions
```

If `ADMIN_KEY` is set, the same actions are available over HTTP via the `X-Admin-Key` header.

---

## 🔐 Data & privacy

| Stored where | What |
|--------------|------|
| Browser (IndexedDB) | books, reading position, saved words (SRS), settings |
| Server SQLite (`CONTEXTA_DB`) | users, sessions, translation cache, per-book KB, vocabulary |
| Server (`BOOKS_DIR`) | uploaded EPUB files |

Only the selected word and its surrounding sentence are sent to the server. Deleting the SQLite file leaves your books intact (they live in `BOOKS_DIR`) — tables are recreated empty on next start.

---

## 🌱 Part of Homo Agens

Contexta is part of **[Homo Agens](https://github.com/homoagens)** — exploring autonomous agents and local inference, on a simple thesis: *the model matters less than the architecture around it.*

[Email](mailto:homoagens1@gmail.com) &nbsp;·&nbsp; [X / Twitter](https://x.com/homoagens1)

---

## License

[MIT](./LICENSE) © 2026 homoagens
