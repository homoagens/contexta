"""User authentication: PBKDF2 hashing, SQLite storage, persistent sessions."""
from __future__ import annotations

import base64, hashlib, logging, os, secrets, time
from pathlib import Path
from typing import Optional

from .db import conn as _conn

log = logging.getLogger("agent.auth")


def init_db() -> None:
    """Create tables and migrate from legacy JSON if present."""
    with _conn() as con:
        con.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                username   TEXT PRIMARY KEY,
                password   TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                last_login INTEGER,
                disabled   INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token      TEXT PRIMARY KEY,
                username   TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions(username);
            CREATE INDEX IF NOT EXISTS idx_sessions_expires  ON sessions(expires_at);
        """)
    _migrate_json()
    from .config import DB_FILE
    log.info("Auth DB ready: %s", DB_FILE)


def _migrate_json() -> None:
    """One-time migration from legacy users.json (renamed to .migrated on completion)."""
    try:
        from .config import USERS_FILE
    except ImportError:
        return
    p = Path(USERS_FILE)
    if not p.exists():
        return
    import json
    try:
        users = json.loads(p.read_text())
    except Exception:
        return
    if not users:
        return
    now = int(time.time())
    with _conn() as con:
        for username, data in users.items():
            exists = con.execute(
                "SELECT 1 FROM users WHERE username=?", (username,)
            ).fetchone()
            if not exists:
                con.execute(
                    "INSERT INTO users (username, password, created_at) VALUES (?,?,?)",
                    (username, data["password"], now),
                )
                log.info("Migrated user: %s", username)
    dest = p.with_suffix(".json.migrated")
    p.rename(dest)
    log.info("JSON migration complete — old file renamed to %s", dest)


# ---------------------------------------------------------------------------
# Password helpers
# ---------------------------------------------------------------------------

def hash_password(password: str) -> str:
    salt = os.urandom(16)
    key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000)
    return base64.b64encode(salt + key).decode()


def verify_password(password: str, stored: str) -> bool:
    try:
        data = base64.b64decode(stored.encode())
        salt, key = data[:16], data[16:]
        new_key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000)
        return secrets.compare_digest(key, new_key)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Core auth
# ---------------------------------------------------------------------------

def is_first_run() -> bool:
    """True when no active (non-disabled) users exist."""
    with _conn() as con:
        row = con.execute("SELECT COUNT(*) FROM users WHERE disabled=0").fetchone()
        return row[0] == 0


def create_user(username: str, password: str) -> bool:
    """Returns False if username already exists."""
    with _conn() as con:
        if con.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone():
            return False
        con.execute(
            "INSERT INTO users (username, password, created_at) VALUES (?,?,?)",
            (username, hash_password(password), int(time.time())),
        )
    log.info("User created: %s", username)
    return True


def authenticate(username: str, password: str) -> Optional[str]:
    """Returns a session token on success, None on failure."""
    from .config import SESSION_TTL_DAYS
    with _conn() as con:
        row = con.execute(
            "SELECT password, disabled FROM users WHERE username=?", (username,)
        ).fetchone()
        if not row or row[1]:
            return None
        if not verify_password(password, row[0]):
            return None
        token = secrets.token_urlsafe(32)
        now = int(time.time())
        con.execute(
            "INSERT INTO sessions (token, username, created_at, expires_at) VALUES (?,?,?,?)",
            (token, username, now, now + SESSION_TTL_DAYS * 86400),
        )
        con.execute("UPDATE users SET last_login=? WHERE username=?", (now, username))
    log.info("Login: %s", username)
    return token


def validate_token(token: str) -> Optional[str]:
    """Returns username if token is active and not expired, None otherwise."""
    now = int(time.time())
    with _conn() as con:
        row = con.execute(
            """SELECT s.username FROM sessions s
               JOIN users u ON u.username = s.username
               WHERE s.token=? AND s.expires_at > ? AND u.disabled=0""",
            (token, now),
        ).fetchone()
    return row[0] if row else None


def revoke_token(token: str) -> None:
    with _conn() as con:
        con.execute("DELETE FROM sessions WHERE token=?", (token,))


# ---------------------------------------------------------------------------
# Admin functions
# ---------------------------------------------------------------------------

def list_users() -> list[dict]:
    with _conn() as con:
        rows = con.execute(
            "SELECT username, created_at, last_login, disabled FROM users ORDER BY created_at"
        ).fetchall()
    return [
        {
            "username":   r[0],
            "created_at": r[1],
            "last_login": r[2],
            "disabled":   bool(r[3]),
        }
        for r in rows
    ]


def delete_user(username: str) -> bool:
    with _conn() as con:
        cur = con.execute("DELETE FROM users WHERE username=?", (username,))
        deleted = cur.rowcount > 0
    if deleted:
        log.info("User deleted: %s", username)
    return deleted


def set_disabled(username: str, disabled: bool) -> bool:
    with _conn() as con:
        cur = con.execute(
            "UPDATE users SET disabled=? WHERE username=?", (int(disabled), username)
        )
        changed = cur.rowcount > 0
    if changed:
        log.info("User %s: %s", username, "disabled" if disabled else "enabled")
    return changed


def reset_password(username: str, new_password: str) -> bool:
    """Update password and revoke all existing sessions."""
    with _conn() as con:
        cur = con.execute(
            "UPDATE users SET password=? WHERE username=?",
            (hash_password(new_password), username),
        )
        if cur.rowcount == 0:
            return False
        con.execute("DELETE FROM sessions WHERE username=?", (username,))
    log.info("Password reset: %s", username)
    return True


def list_sessions() -> list[dict]:
    """Active (non-expired) sessions, newest first."""
    now = int(time.time())
    with _conn() as con:
        rows = con.execute(
            """SELECT token, username, created_at, expires_at
               FROM sessions WHERE expires_at > ?
               ORDER BY created_at DESC""",
            (now,),
        ).fetchall()
    return [
        {
            "token":      r[0][:12] + "…",
            "username":   r[1],
            "created_at": r[2],
            "expires_at": r[3],
        }
        for r in rows
    ]


def revoke_user_sessions(username: str) -> int:
    with _conn() as con:
        cur = con.execute("DELETE FROM sessions WHERE username=?", (username,))
        return cur.rowcount


def purge_expired_sessions() -> int:
    now = int(time.time())
    with _conn() as con:
        cur = con.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
        return cur.rowcount
