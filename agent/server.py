"""Optional local HTTP server for the agent."""
from __future__ import annotations

import json as _json
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

from fastapi import (
    BackgroundTasks, Depends, FastAPI, Form, Header, HTTPException, UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, ORJSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import config
from .agent import Agent
from .schemas import TranslateInput
from .skills.translate import TranslateSkill

_TRANSLATE_FIELDS = set(TranslateInput.__dataclass_fields__)
from .books import (
    init_books_db, list_books, save_book as store_book, delete_book as remove_book,
    get_book_path, save_position, get_position, get_quota_used,
)
from .translation_cache import init_cache_db
from .vocab import init_vocab_db, record_lookup, hard_words, get_profile
from .book_kb import (
    init_kb_db, extract_chapters, get_kb, save_kb, set_status, kb_status,
    STATUS_PENDING, STATUS_FAILED,
)
from .auth import (
    authenticate, create_user, init_db, is_first_run, revoke_token, validate_token,
    list_users, delete_user, set_disabled, reset_password,
    list_sessions, revoke_user_sessions, purge_expired_sessions,
)

log = logging.getLogger("agent.server")

_DIST = Path(__file__).parent.parent / "interface-web" / "dist"
_agent: Optional[Agent] = None


@asynccontextmanager
async def _lifespan(app: FastAPI):  # type: ignore[type-arg]
    init_db()
    init_books_db()
    init_cache_db()
    init_kb_db()
    init_vocab_db()
    yield
    if _agent is not None:
        await _agent.client.close()


app = FastAPI(title="Contexta Agent Server", lifespan=_lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Auth dependencies
# ---------------------------------------------------------------------------

def _bearer(authorization: str = Header(default="")) -> str:
    return authorization[7:] if authorization.startswith("Bearer ") else ""


def require_auth(authorization: str = Header(default="")) -> str:
    token = authorization[7:] if authorization.startswith("Bearer ") else ""
    user = validate_token(token) if token else None
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return user


def require_admin(x_admin_key: str = Header(default="")) -> None:
    from .config import ADMIN_KEY
    if not ADMIN_KEY:
        raise HTTPException(status_code=501, detail="Admin key not configured (set ADMIN_KEY env var)")
    if not x_admin_key or x_admin_key != ADMIN_KEY:
        raise HTTPException(status_code=403, detail="Invalid admin key")


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str
    password: str


class ResetPasswordRequest(BaseModel):
    new_password: str


class SavePositionRequest(BaseModel):
    cfi: str
    progress: int = 0


class BatchTranslateItem(BaseModel):
    span: str = ""
    sentence: str = ""


class BatchTranslateRequest(BaseModel):
    items: list[BatchTranslateItem] = []
    source_lang: str = "en"
    target_lang: str = "it"
    model: str = ""


class BookChatRequest(BaseModel):
    book_id: str = ""
    question: str = ""
    persona: bool = False
    up_to_chapter: Optional[int] = None
    target_lang: str = "it"


class ChatContextRequest(BaseModel):
    translation_result: dict = {}
    question: str = ""
    constrained: bool = True


class TranslateRequest(BaseModel):
    selected_span: str = ""
    target_sentence: str = ""
    context_before: str = ""
    context_after: str = ""
    source_lang: str = "en"
    target_lang: str = "it"
    context_mode: str = "fast"
    model: str = ""
    temperature: float = 0.1
    max_tokens: int = 2048

    def resolve(self) -> dict:
        span = self.selected_span.strip()
        if not span:
            raise ValueError("selected_span is required")
        if len(span.split()) > 5:
            raise ValueError("selected_span too long: max 5 words allowed")
        return {
            "selected_span":   span,
            "target_sentence": self.target_sentence,
            "context_before":  self.context_before,
            "context_after":   self.context_after,
            "source_lang":     self.source_lang,
            "target_lang":     self.target_lang,
            "context_mode":    self.context_mode,
            "model":           self.model,
            "temperature":     self.temperature,
            "max_tokens":      self.max_tokens,
        }


# ---------------------------------------------------------------------------
# Auth endpoints (public)
# ---------------------------------------------------------------------------

@app.get("/check_first_run")
async def check_first_run_endpoint() -> Any:
    return ORJSONResponse({"first_run": is_first_run()})


@app.post("/login")
async def login_endpoint(req: LoginRequest) -> Any:
    token = authenticate(req.username, req.password)
    if not token:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return ORJSONResponse({"token": token, "username": req.username})


@app.post("/register")
async def register_endpoint(req: RegisterRequest) -> Any:
    """Available on first run or when ALLOW_REGISTRATION=true."""
    if not is_first_run() and not config.ALLOW_REGISTRATION:
        raise HTTPException(status_code=403, detail="Registration closed")
    if not create_user(req.username, req.password):
        raise HTTPException(status_code=409, detail="User already exists")
    token = authenticate(req.username, req.password)
    return ORJSONResponse({"token": token, "username": req.username})


@app.post("/logout")
async def logout_endpoint(token: str = Depends(_bearer)) -> Any:
    if token:
        revoke_token(token)
    return ORJSONResponse({"ok": True})


@app.get("/me")
async def me_endpoint(user: str = Depends(require_auth)) -> Any:
    return ORJSONResponse({"username": user})


# ---------------------------------------------------------------------------
# Protected endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
async def health() -> Any:
    status: dict = {"ok": True, "mode": "agent"}
    if _agent is not None:
        try:
            backend_status = await _agent.health()
            status["backend"] = backend_status
        except Exception as e:
            status["backend_error"] = str(e)
    return ORJSONResponse(status)


@app.post("/chat_context")
async def chat_context(req: ChatContextRequest, _user: str = Depends(require_auth)) -> Any:
    if _agent is None:
        raise HTTPException(status_code=503, detail="Agent not initialised")
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="question is required")
    try:
        result = await _agent.run("chat", {
            "translation_result": req.translation_result,
            "question": req.question,
            "constrained": req.constrained,
        })
        return ORJSONResponse(result)
    except Exception as e:
        log.error("Chat context failed: %s", e)
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/translate")
async def translate(req: TranslateRequest, user: str = Depends(require_auth)) -> Any:
    if _agent is None:
        raise HTTPException(status_code=503, detail="Agent not initialised")
    try:
        result = await _agent.run("translate", req.resolve())
        # Record the lookup for the user's vocabulary profile (best-effort)
        try:
            record_lookup(user, req.selected_span, req.source_lang)
        except Exception as ve:
            log.warning("Vocab record failed (non-fatal): %s", ve)
        return ORJSONResponse(result)
    except Exception as e:
        log.error("Translation failed: %s", e)
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/translate_stream")
async def translate_stream_endpoint(
    req: TranslateRequest, user: str = Depends(require_auth)
) -> Any:
    """SSE stream of LLM token deltas followed by the final structured result.

    Each SSE message is a JSON object with a "type" field:
      {"type": "token",  "text":  "..."}   — incremental LLM output
      {"type": "result", "data":  {...}}    — final parsed TranslateOutput
      {"type": "error",  "message": "..."}  — unrecoverable failure
    """
    if _agent is None:
        raise HTTPException(status_code=503, detail="Agent not initialised")
    try:
        resolved = req.resolve()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    skill: TranslateSkill = _agent._skills["translate"]  # type: ignore[assignment]
    inp = TranslateInput(**{k: v for k, v in resolved.items() if k in _TRANSLATE_FIELDS})
    # Capture references before entering the generator (avoids closure over mutable globals)
    client = _agent.client
    span = req.selected_span
    src_lang = req.source_lang

    async def _gen():
        try:
            async for kind, data in skill.run_stream(inp, client):
                if kind == "token":
                    payload = _json.dumps({"type": "token", "text": data})
                else:
                    payload = _json.dumps({"type": "result", "data": data.to_dict()})
                    try:
                        record_lookup(user, span, src_lang)
                    except Exception:
                        pass
                yield f"data: {payload}\n\n"
        except Exception as e:
            log.error("translate_stream failed: %s", e)
            yield f"data: {_json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        _gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/translate_batch")
async def translate_batch(
    req: BatchTranslateRequest, _user: str = Depends(require_auth)
) -> Any:
    """Pre-translate a page's worth of words to warm the cache. Best-effort:
    never fails the caller — returns counts even if the LLM call fails."""
    if _agent is None:
        raise HTTPException(status_code=503, detail="Agent not initialised")
    try:
        result = await _agent.run("batch_translate", {
            "items": [i.model_dump() for i in req.items],
            "source_lang": req.source_lang,
            "target_lang": req.target_lang,
            "model": req.model,
        })
        return ORJSONResponse(result)
    except Exception as e:
        log.warning("Batch translation failed (non-fatal): %s", e)
        return ORJSONResponse({"requested": len(req.items), "translated": 0, "cache_hits": 0})


# ---------------------------------------------------------------------------
# Vocabulary endpoints
# ---------------------------------------------------------------------------

@app.get("/vocab/profile")
async def vocab_profile(user: str = Depends(require_auth)) -> Any:
    return ORJSONResponse(get_profile(user))


@app.get("/vocab/hard")
async def vocab_hard(source_lang: str = "en", user: str = Depends(require_auth)) -> Any:
    """Words the user has looked up before — candidates for predictive glossing."""
    return ORJSONResponse({"words": hard_words(user, source_lang)})


# ---------------------------------------------------------------------------
# Book endpoints
# ---------------------------------------------------------------------------

async def _analyze_book_bg(book_id: str, epub_path: str) -> None:
    """Background job: extract chapters, build the per-book KB, store it."""
    if _agent is None:
        return
    try:
        set_status(book_id, STATUS_PENDING)
        chapters = extract_chapters(epub_path)
        kb = await _agent.run("analyze", {"chapters": chapters})
        save_kb(book_id, kb)
    except Exception as e:
        log.error("Book analysis failed for %s: %s", book_id, e)
        set_status(book_id, STATUS_FAILED)


@app.get("/books/quota")
async def books_quota(user: str = Depends(require_auth)) -> Any:
    from .config import BOOKS_QUOTA_MB
    return ORJSONResponse({
        "used_bytes":  get_quota_used(user),
        "total_bytes": BOOKS_QUOTA_MB * 1024 * 1024,
    })


@app.get("/books")
async def books_list(user: str = Depends(require_auth)) -> Any:
    return ORJSONResponse(list_books(user))


@app.post("/books")
async def books_upload(
    file:       UploadFile,
    background: BackgroundTasks,
    title:  str = Form(""),
    author: str = Form(""),
    cover:  str = Form(""),
    user:   str = Depends(require_auth),
) -> Any:
    data = await file.read()
    try:
        book_id, existed = store_book(
            user, file.filename or "book.epub",
            title, author, cover or None, data,
        )
    except ValueError as e:
        raise HTTPException(status_code=413, detail=str(e))
    # Build the per-book knowledge base once (shared across users by content hash)
    if kb_status(book_id) is None:
        path = get_book_path(user, book_id)
        if path:
            set_status(book_id, STATUS_PENDING)
            background.add_task(_analyze_book_bg, book_id, str(path))
    return ORJSONResponse({"id": book_id, "existed": existed})


@app.delete("/books/{book_id}")
async def books_delete(book_id: str, user: str = Depends(require_auth)) -> Any:
    if not remove_book(user, book_id):
        raise HTTPException(status_code=404, detail="Book not found")
    return ORJSONResponse({"ok": True})


@app.get("/books/{book_id}/file")
async def books_get_file(book_id: str, user: str = Depends(require_auth)) -> Any:
    path = get_book_path(user, book_id)
    if not path:
        raise HTTPException(status_code=404, detail="Book not found")
    return FileResponse(str(path), media_type="application/epub+zip")


@app.put("/books/{book_id}/position")
async def books_save_position(
    book_id: str, req: SavePositionRequest, user: str = Depends(require_auth)
) -> Any:
    try:
        save_position(user, book_id, req.cfi, req.progress)
    except ValueError:
        raise HTTPException(status_code=404, detail="Book not found")
    return ORJSONResponse({"ok": True})


@app.get("/books/{book_id}/position")
async def books_get_position(book_id: str, user: str = Depends(require_auth)) -> Any:
    pos = get_position(user, book_id)
    return ORJSONResponse(pos if pos else {"cfi": None, "progress": 0})


@app.post("/book_chat")
async def book_chat(req: BookChatRequest, user: str = Depends(require_auth)) -> Any:
    """Contextual Q&A about a book, grounded in its knowledge base."""
    if _agent is None:
        raise HTTPException(status_code=503, detail="Agent not initialised")
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="question is required")
    if not get_book_path(user, req.book_id):
        raise HTTPException(status_code=404, detail="Book not found")
    kb_row = get_kb(req.book_id)
    if not kb_row or kb_row.get("status") != "ready" or not kb_row.get("kb"):
        raise HTTPException(status_code=409, detail="Book knowledge base not ready yet")
    try:
        result = await _agent.run("book_chat", {
            "kb": kb_row["kb"],
            "question": req.question,
            "persona": req.persona,
            "up_to_chapter": req.up_to_chapter,
            "target_lang": req.target_lang,
        })
        return ORJSONResponse(result)
    except Exception as e:
        log.error("Book chat failed: %s", e)
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/books/{book_id}/kb")
async def books_get_kb(
    book_id: str, background: BackgroundTasks, user: str = Depends(require_auth)
) -> Any:
    """Return the per-book knowledge base. Triggers analysis on first request
    for books uploaded before the feature existed."""
    path = get_book_path(user, book_id)
    if not path:
        raise HTTPException(status_code=404, detail="Book not found")
    kb = get_kb(book_id)
    if kb is None:
        set_status(book_id, STATUS_PENDING)
        background.add_task(_analyze_book_bg, book_id, str(path))
        return ORJSONResponse({"status": STATUS_PENDING, "kb": None})
    return ORJSONResponse(kb)


# ---------------------------------------------------------------------------
# Admin endpoints (require X-Admin-Key header)
# ---------------------------------------------------------------------------

@app.get("/admin/users")
async def admin_list_users(_: None = Depends(require_admin)) -> Any:
    return ORJSONResponse(list_users())


@app.delete("/admin/users/{username}")
async def admin_delete_user(username: str, _: None = Depends(require_admin)) -> Any:
    if not delete_user(username):
        raise HTTPException(status_code=404, detail="User not found")
    return ORJSONResponse({"ok": True, "deleted": username})


@app.post("/admin/users/{username}/disable")
async def admin_disable_user(username: str, _: None = Depends(require_admin)) -> Any:
    if not set_disabled(username, True):
        raise HTTPException(status_code=404, detail="User not found")
    return ORJSONResponse({"ok": True, "username": username, "disabled": True})


@app.post("/admin/users/{username}/enable")
async def admin_enable_user(username: str, _: None = Depends(require_admin)) -> Any:
    if not set_disabled(username, False):
        raise HTTPException(status_code=404, detail="User not found")
    return ORJSONResponse({"ok": True, "username": username, "disabled": False})


@app.post("/admin/users/{username}/reset-password")
async def admin_reset_password(
    username: str, req: ResetPasswordRequest, _: None = Depends(require_admin)
) -> Any:
    if not req.new_password:
        raise HTTPException(status_code=400, detail="new_password is required")
    if not reset_password(username, req.new_password):
        raise HTTPException(status_code=404, detail="User not found")
    return ORJSONResponse({"ok": True, "username": username})


@app.get("/admin/sessions")
async def admin_list_sessions(_: None = Depends(require_admin)) -> Any:
    return ORJSONResponse(list_sessions())


@app.delete("/admin/sessions/{username}")
async def admin_revoke_user_sessions(username: str, _: None = Depends(require_admin)) -> Any:
    n = revoke_user_sessions(username)
    return ORJSONResponse({"ok": True, "revoked": n})


@app.post("/admin/sessions/purge")
async def admin_purge_sessions(_: None = Depends(require_admin)) -> Any:
    n = purge_expired_sessions()
    return ORJSONResponse({"ok": True, "purged": n})


# ---------------------------------------------------------------------------
# Static frontend
# ---------------------------------------------------------------------------

_NO_CACHE = {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
}

if _DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=_DIST / "assets"), name="assets")

    @app.get("/", include_in_schema=False)
    async def _index_root() -> FileResponse:
        return FileResponse(str(_DIST / "index.html"), headers=_NO_CACHE)

    @app.get("/{full_path:path}", include_in_schema=False)
    async def _spa_fallback(full_path: str) -> FileResponse:
        target = _DIST / full_path
        if target.is_file():
            return FileResponse(str(target), headers=_NO_CACHE)
        return FileResponse(str(_DIST / "index.html"), headers=_NO_CACHE)

    log.info("Frontend statico montato da %s", _DIST)


# ---------------------------------------------------------------------------
# Launcher
# ---------------------------------------------------------------------------

def run_server(backend_url: str, api_key: str, port: int = 8001) -> None:
    global _agent
    import uvicorn
    _agent = Agent(backend_url, api_key)
    log.info("Agent server on port %d — backend=%s", port, backend_url)
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
