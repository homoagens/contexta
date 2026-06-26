"""Book storage and reading-position management (SQLite + filesystem)."""
from __future__ import annotations

import hashlib, logging, time
from pathlib import Path
from typing import Optional

from .db import conn as _conn

log = logging.getLogger("agent.books")


def init_books_db() -> None:
    with _conn() as con:
        con.executescript("""
            CREATE TABLE IF NOT EXISTS books (
                id          TEXT NOT NULL,
                username    TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
                filename    TEXT NOT NULL,
                title       TEXT NOT NULL DEFAULT '',
                author      TEXT NOT NULL DEFAULT '',
                cover       TEXT,
                size_bytes  INTEGER NOT NULL,
                uploaded_at INTEGER NOT NULL,
                PRIMARY KEY (id, username)
            );
            CREATE TABLE IF NOT EXISTS reading_positions (
                username   TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
                book_id    TEXT NOT NULL,
                cfi        TEXT NOT NULL,
                progress   INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (username, book_id)
            );
            CREATE INDEX IF NOT EXISTS idx_books_username ON books(username);
        """)
        # Safe migration: add progress column if missing (table existed before)
        try:
            con.execute("ALTER TABLE reading_positions ADD COLUMN progress INTEGER NOT NULL DEFAULT 0")
        except Exception:
            pass
    log.info("Books DB ready")


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _book_id(data: bytes) -> str:
    """Stable ID: first 32 hex chars of SHA-256."""
    return hashlib.sha256(data).hexdigest()[:32]


def _book_path(username: str, book_id: str) -> Path:
    from .config import BOOKS_DIR
    return Path(BOOKS_DIR) / username / f"{book_id}.epub"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_quota_used(username: str) -> int:
    with _conn() as con:
        row = con.execute(
            "SELECT COALESCE(SUM(size_bytes), 0) FROM books WHERE username=?", (username,)
        ).fetchone()
    return row[0]


def list_books(username: str) -> list[dict]:
    with _conn() as con:
        rows = con.execute(
            """SELECT b.id, b.filename, b.title, b.author, b.cover,
                      b.size_bytes, b.uploaded_at, rp.cfi, rp.progress
               FROM books b
               LEFT JOIN reading_positions rp
                     ON rp.username = b.username AND rp.book_id = b.id
               WHERE b.username = ?
               ORDER BY COALESCE(rp.updated_at, b.uploaded_at) DESC""",
            (username,),
        ).fetchall()
    return [
        {
            "id":            r[0],
            "filename":      r[1],
            "title":         r[2],
            "author":        r[3],
            "cover":         r[4],
            "size_bytes":    r[5],
            "uploaded_at":   r[6],
            "last_cfi":      r[7],
            "last_progress": r[8],
        }
        for r in rows
    ]


def save_book(
    username: str,
    filename: str,
    title: str,
    author: str,
    cover: Optional[str],
    data: bytes,
) -> tuple[str, bool]:
    """Store a book.  Returns (book_id, already_existed)."""
    from .config import BOOKS_QUOTA_MB
    book_id = _book_id(data)
    with _conn() as con:
        if con.execute(
            "SELECT 1 FROM books WHERE id=? AND username=?", (book_id, username)
        ).fetchone():
            return book_id, True
        used = con.execute(
            "SELECT COALESCE(SUM(size_bytes), 0) FROM books WHERE username=?", (username,)
        ).fetchone()[0]
        if used + len(data) > BOOKS_QUOTA_MB * 1024 * 1024:
            raise ValueError(f"Quota exceeded ({BOOKS_QUOTA_MB} MB limit)")
        path = _book_path(username, book_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        con.execute(
            """INSERT INTO books
               (id, username, filename, title, author, cover, size_bytes, uploaded_at)
               VALUES (?,?,?,?,?,?,?,?)""",
            (book_id, username, filename, title, author, cover, len(data), int(time.time())),
        )
    log.info("Book saved: %s/%s (%d bytes)", username, filename, len(data))
    return book_id, False


def delete_book(username: str, book_id: str) -> bool:
    with _conn() as con:
        cur = con.execute(
            "DELETE FROM books WHERE id=? AND username=?", (book_id, username)
        )
        if cur.rowcount == 0:
            return False
        con.execute(
            "DELETE FROM reading_positions WHERE username=? AND book_id=?",
            (username, book_id),
        )
        # Delete the file only if no other user has the same book
        others = con.execute(
            "SELECT COUNT(*) FROM books WHERE id=?", (book_id,)
        ).fetchone()[0]
    if others == 0:
        path = _book_path(username, book_id)
        if path.exists():
            path.unlink()
    log.info("Book deleted: %s/%s", username, book_id)
    return True


def get_book_path(username: str, book_id: str) -> Optional[Path]:
    with _conn() as con:
        row = con.execute(
            "SELECT 1 FROM books WHERE id=? AND username=?", (book_id, username)
        ).fetchone()
    if not row:
        return None
    path = _book_path(username, book_id)
    return path if path.exists() else None


def save_position(username: str, book_id: str, cfi: str, progress: int = 0) -> None:
    with _conn() as con:
        if not con.execute(
            "SELECT 1 FROM books WHERE id=? AND username=?", (book_id, username)
        ).fetchone():
            raise ValueError("Book not found")
        con.execute(
            """INSERT INTO reading_positions (username, book_id, cfi, progress, updated_at)
               VALUES (?,?,?,?,?)
               ON CONFLICT(username, book_id)
               DO UPDATE SET cfi=excluded.cfi, progress=excluded.progress,
                             updated_at=excluded.updated_at""",
            (username, book_id, cfi, max(0, min(100, progress)), int(time.time())),
        )


def get_position(username: str, book_id: str) -> Optional[dict]:
    with _conn() as con:
        row = con.execute(
            "SELECT cfi, progress FROM reading_positions WHERE username=? AND book_id=?",
            (username, book_id),
        ).fetchone()
    return {"cfi": row[0], "progress": row[1]} if row else None
