"""Shared SQLite connection helper (WAL mode, foreign keys).

Every module that needs the database imports `conn()` from here
instead of duplicating connection logic.
"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Generator


@contextmanager
def conn() -> Generator[sqlite3.Connection, None, None]:
    """Open a WAL-mode SQLite connection, commit on success, rollback on error."""
    from .config import DB_FILE
    Path(DB_FILE).parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_FILE, check_same_thread=False)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()
