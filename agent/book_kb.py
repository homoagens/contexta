"""Per-book knowledge base — EPUB text extraction + KB storage.

The KB is built once per book (keyed by the content-hash book id, so it is
shared across users who own the same file). It powers contextual chat,
the "speak as the book" persona, and chapter briefings.

KB shape:
    {
        "summary":   "one-paragraph book summary",
        "themes":    ["theme", ...],
        "characters":[{"name": "...", "description": "..."}],
        "chapters":  [{"index": 0, "title": "...", "summary": "..."}]
    }
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Optional

from .db import conn as _conn

log = logging.getLogger("agent.book_kb")

# Status values for the book_kb row
STATUS_PENDING = "pending"
STATUS_READY = "ready"
STATUS_FAILED = "failed"


def init_kb_db() -> None:
    with _conn() as con:
        con.executescript("""
            CREATE TABLE IF NOT EXISTS book_kb (
                book_id    TEXT PRIMARY KEY,
                status     TEXT NOT NULL DEFAULT 'pending',
                kb_json    TEXT,
                updated_at INTEGER NOT NULL
            );
        """)
    log.info("Book KB table ready")


def kb_status(book_id: str) -> Optional[str]:
    """Return the KB status for a book, or None if no row exists yet."""
    with _conn() as con:
        row = con.execute(
            "SELECT status FROM book_kb WHERE book_id=?", (book_id,)
        ).fetchone()
    return row[0] if row else None


def get_kb(book_id: str) -> Optional[dict]:
    """Return {status, kb} for a book, or None if never analyzed."""
    with _conn() as con:
        row = con.execute(
            "SELECT status, kb_json FROM book_kb WHERE book_id=?", (book_id,)
        ).fetchone()
    if not row:
        return None
    kb = None
    if row[1]:
        try:
            kb = json.loads(row[1])
        except Exception:
            kb = None
    return {"status": row[0], "kb": kb}


def set_status(book_id: str, status: str) -> None:
    with _conn() as con:
        con.execute(
            """INSERT INTO book_kb (book_id, status, updated_at)
               VALUES (?,?,?)
               ON CONFLICT(book_id) DO UPDATE SET
                   status=excluded.status, updated_at=excluded.updated_at""",
            (book_id, status, int(time.time())),
        )


def save_kb(book_id: str, kb: dict) -> None:
    with _conn() as con:
        con.execute(
            """INSERT INTO book_kb (book_id, status, kb_json, updated_at)
               VALUES (?,?,?,?)
               ON CONFLICT(book_id) DO UPDATE SET
                   status=excluded.status, kb_json=excluded.kb_json,
                   updated_at=excluded.updated_at""",
            (book_id, STATUS_READY, json.dumps(kb, ensure_ascii=False), int(time.time())),
        )
    log.info("KB saved for book %s", book_id)


# ---------------------------------------------------------------------------
# EPUB text extraction
# ---------------------------------------------------------------------------

# Chapters shorter than this are skipped (cover pages, ToC, copyright pages)
_MIN_CHAPTER_CHARS = 400


def extract_chapters(epub_path: str | Path) -> list[dict]:
    """Extract readable chapters from an EPUB file.

    Returns a list of {title, text}. Requires EbookLib + beautifulsoup4.
    """
    import ebooklib
    from ebooklib import epub
    from bs4 import BeautifulSoup

    book = epub.read_epub(str(epub_path))
    chapters: list[dict] = []
    for item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT):
        try:
            soup = BeautifulSoup(item.get_content(), "html.parser")
        except Exception:
            continue
        text = soup.get_text(separator=" ", strip=True)
        if len(text) < _MIN_CHAPTER_CHARS:
            continue
        heading = soup.find(["h1", "h2", "h3"])
        title = heading.get_text(strip=True) if heading else ""
        chapters.append({"title": title, "text": text})
    return chapters
