"""Translation cache — two-level SQLite cache for translate/synonym results.

Keying strategy:
  - Context-free   : when the request has no surrounding sentence (sentence
                     empty or equal to the span), the translation does not
                     depend on context → key = span only. Maximizes hits.
  - Context-sensitive: when a real sentence is present, the sense may depend
                     on it → key includes a hash of the sentence. Guarantees
                     correctness for polysemous words.

The cached value is the full TranslateOutput serialized as a dict, so a hit
reconstructs the exact object the skill would have returned.

Bump CACHE_VERSION whenever prompts or output shape change — this invalidates
every stored entry without a manual purge.
"""
from __future__ import annotations

import hashlib
import json
import logging
import time
from typing import Optional

from .db import conn as _conn

log = logging.getLogger("agent.translation_cache")

# Increment when prompts.py or TranslateOutput change in a way that would make
# previously cached results wrong.
CACHE_VERSION = "1"


def init_cache_db() -> None:
    """Create the translation_cache table if it does not exist."""
    with _conn() as con:
        con.executescript("""
            CREATE TABLE IF NOT EXISTS translation_cache (
                cache_key    TEXT PRIMARY KEY,
                span         TEXT NOT NULL,
                source_lang  TEXT NOT NULL,
                target_lang  TEXT NOT NULL,
                mode         TEXT NOT NULL,
                result_json  TEXT NOT NULL,
                hits         INTEGER NOT NULL DEFAULT 0,
                created_at   INTEGER NOT NULL,
                last_hit_at  INTEGER
            );
        """)
    log.info("Translation cache ready (version %s)", CACHE_VERSION)


def make_key(
    span: str,
    sentence: str,
    source_lang: str,
    target_lang: str,
    mode: str,
    model: str,
) -> str:
    """Build the cache key. Context-free if no real sentence is present."""
    span_n = span.strip().lower()
    sent_n = sentence.strip().lower()
    parts = [CACHE_VERSION, model, source_lang, target_lang, mode, span_n]
    # Only include the sentence when it adds real context
    if sent_n and sent_n != span_n:
        parts.append(hashlib.sha256(sent_n.encode("utf-8")).hexdigest()[:16])
    raw = "\x1f".join(parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def get(key: str) -> Optional[dict]:
    """Return the cached TranslateOutput dict, or None on miss. Counts the hit."""
    with _conn() as con:
        row = con.execute(
            "SELECT result_json FROM translation_cache WHERE cache_key=?", (key,)
        ).fetchone()
        if not row:
            return None
        con.execute(
            "UPDATE translation_cache SET hits=hits+1, last_hit_at=? WHERE cache_key=?",
            (int(time.time()), key),
        )
    try:
        return json.loads(row[0])
    except Exception:
        return None


def put(
    key: str,
    span: str,
    source_lang: str,
    target_lang: str,
    mode: str,
    result: dict,
) -> None:
    """Store a successful, validated translation result."""
    with _conn() as con:
        con.execute(
            """INSERT INTO translation_cache
               (cache_key, span, source_lang, target_lang, mode, result_json, created_at)
               VALUES (?,?,?,?,?,?,?)
               ON CONFLICT(cache_key) DO UPDATE SET
                   result_json=excluded.result_json,
                   created_at=excluded.created_at""",
            (key, span, source_lang, target_lang, mode,
             json.dumps(result, ensure_ascii=False), int(time.time())),
        )


def stats() -> dict:
    """Cache size and aggregate hit count — for monitoring."""
    with _conn() as con:
        row = con.execute(
            "SELECT COUNT(*), COALESCE(SUM(hits), 0) FROM translation_cache"
        ).fetchone()
    return {"entries": row[0], "total_hits": row[1]}
