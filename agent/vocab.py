"""User vocabulary profile — tracks which words a reader looks up.

Every successful single-word translation is recorded. The set of words a
user has looked up is, by definition, the set of words that user found
hard — this drives predictive glossing (auto-showing translations for words
the reader has struggled with before).
"""
from __future__ import annotations

import logging
import time
from typing import Optional

from .db import conn as _conn

log = logging.getLogger("agent.vocab")


def init_vocab_db() -> None:
    with _conn() as con:
        con.executescript("""
            CREATE TABLE IF NOT EXISTS vocab_lookups (
                username    TEXT NOT NULL,
                word        TEXT NOT NULL,
                source_lang TEXT NOT NULL,
                count       INTEGER NOT NULL DEFAULT 1,
                first_seen  INTEGER NOT NULL,
                last_seen   INTEGER NOT NULL,
                PRIMARY KEY (username, word, source_lang)
            );
            CREATE INDEX IF NOT EXISTS idx_vocab_user
                ON vocab_lookups(username, source_lang);
        """)
    log.info("Vocab table ready")


def record_lookup(username: str, word: str, source_lang: str) -> None:
    """Record one lookup. Multi-word spans are ignored (not vocabulary)."""
    w = word.strip().lower()
    if not w or " " in w:
        return
    now = int(time.time())
    with _conn() as con:
        con.execute(
            """INSERT INTO vocab_lookups
               (username, word, source_lang, count, first_seen, last_seen)
               VALUES (?,?,?,1,?,?)
               ON CONFLICT(username, word, source_lang) DO UPDATE SET
                   count=count+1, last_seen=excluded.last_seen""",
            (username, w, source_lang, now, now),
        )


def hard_words(username: str, source_lang: str, limit: int = 600) -> list[str]:
    """Words the user has looked up — i.e. words hard for them.

    Ordered by recency then frequency so the most relevant words come first.
    """
    with _conn() as con:
        rows = con.execute(
            """SELECT word FROM vocab_lookups
               WHERE username=? AND source_lang=?
               ORDER BY last_seen DESC, count DESC
               LIMIT ?""",
            (username, source_lang, limit),
        ).fetchall()
    return [r[0] for r in rows]


def get_profile(username: str) -> dict:
    """Aggregate vocabulary stats for the user."""
    with _conn() as con:
        total = con.execute(
            "SELECT COUNT(*), COALESCE(SUM(count),0) FROM vocab_lookups WHERE username=?",
            (username,),
        ).fetchone()
        top = con.execute(
            """SELECT word, source_lang, count FROM vocab_lookups
               WHERE username=? ORDER BY count DESC, last_seen DESC LIMIT 20""",
            (username,),
        ).fetchall()
    return {
        "distinct_words": total[0],
        "total_lookups": total[1],
        "top_words": [
            {"word": r[0], "source_lang": r[1], "count": r[2]} for r in top
        ],
    }
