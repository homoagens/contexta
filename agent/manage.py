"""CLI management tool for Contexta auth.

Usage (run from the contexta/ directory):
    python -m agent.manage users list
    python -m agent.manage users create <username>
    python -m agent.manage users delete <username>
    python -m agent.manage users disable <username>
    python -m agent.manage users enable <username>
    python -m agent.manage users reset-password <username>
    python -m agent.manage sessions list
    python -m agent.manage sessions purge
"""
from __future__ import annotations

import argparse
import getpass
import sys
from datetime import datetime


def _ts(ts: int | None) -> str:
    if not ts:
        return "—"
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M")


def _init() -> None:
    from .auth import init_db
    init_db()


# ---------------------------------------------------------------------------
# Users commands
# ---------------------------------------------------------------------------

def cmd_users_list(_args: argparse.Namespace) -> None:
    _init()
    from .auth import list_users
    users = list_users()
    if not users:
        print("No users.")
        return
    print(f"\n{'USERNAME':<22} {'CREATED':<18} {'LAST LOGIN':<18} STATUS")
    print("─" * 70)
    for u in users:
        status = "DISABLED" if u["disabled"] else "active"
        print(f"{u['username']:<22} {_ts(u['created_at']):<18} {_ts(u['last_login']):<18} {status}")
    print()


def cmd_users_create(args: argparse.Namespace) -> None:
    _init()
    from .auth import create_user
    password = getpass.getpass(f"Password for '{args.username}': ")
    if not password:
        print("Error: password cannot be empty.", file=sys.stderr)
        sys.exit(1)
    if create_user(args.username, password):
        print(f"User '{args.username}' created.")
    else:
        print(f"Error: username '{args.username}' already exists.", file=sys.stderr)
        sys.exit(1)


def cmd_users_delete(args: argparse.Namespace) -> None:
    _init()
    from .auth import delete_user
    confirm = input(f"Delete user '{args.username}' and all their sessions? [y/N] ")
    if confirm.strip().lower() != "y":
        print("Aborted.")
        return
    if delete_user(args.username):
        print(f"User '{args.username}' deleted.")
    else:
        print(f"Error: user '{args.username}' not found.", file=sys.stderr)
        sys.exit(1)


def cmd_users_disable(args: argparse.Namespace) -> None:
    _init()
    from .auth import set_disabled
    if set_disabled(args.username, True):
        print(f"User '{args.username}' disabled (cannot login).")
    else:
        print(f"Error: user '{args.username}' not found.", file=sys.stderr)
        sys.exit(1)


def cmd_users_enable(args: argparse.Namespace) -> None:
    _init()
    from .auth import set_disabled
    if set_disabled(args.username, False):
        print(f"User '{args.username}' enabled.")
    else:
        print(f"Error: user '{args.username}' not found.", file=sys.stderr)
        sys.exit(1)


def cmd_users_reset_password(args: argparse.Namespace) -> None:
    _init()
    from .auth import reset_password
    password = getpass.getpass(f"New password for '{args.username}': ")
    if not password:
        print("Error: password cannot be empty.", file=sys.stderr)
        sys.exit(1)
    if reset_password(args.username, password):
        print(f"Password updated. All sessions for '{args.username}' revoked.")
    else:
        print(f"Error: user '{args.username}' not found.", file=sys.stderr)
        sys.exit(1)


# ---------------------------------------------------------------------------
# Sessions commands
# ---------------------------------------------------------------------------

def cmd_sessions_list(_args: argparse.Namespace) -> None:
    _init()
    from .auth import list_sessions
    sessions = list_sessions()
    if not sessions:
        print("No active sessions.")
        return
    print(f"\n{'TOKEN':<15} {'USERNAME':<22} {'CREATED':<18} EXPIRES")
    print("─" * 75)
    for s in sessions:
        print(f"{s['token']:<15} {s['username']:<22} {_ts(s['created_at']):<18} {_ts(s['expires_at'])}")
    print()


def cmd_sessions_purge(_args: argparse.Namespace) -> None:
    _init()
    from .auth import purge_expired_sessions
    n = purge_expired_sessions()
    print(f"Purged {n} expired session(s).")


# ---------------------------------------------------------------------------
# Argument parser
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        prog="python -m agent.manage",
        description="Contexta user/session management",
    )
    sub = parser.add_subparsers(dest="resource", metavar="RESOURCE")

    # users
    users_p = sub.add_parser("users", help="Manage users")
    users_sub = users_p.add_subparsers(dest="action", metavar="ACTION")

    users_sub.add_parser("list", help="List all users")

    p = users_sub.add_parser("create", help="Create a new user")
    p.add_argument("username")

    p = users_sub.add_parser("delete", help="Delete user and all their sessions")
    p.add_argument("username")

    p = users_sub.add_parser("disable", help="Disable user (block login)")
    p.add_argument("username")

    p = users_sub.add_parser("enable", help="Re-enable a disabled user")
    p.add_argument("username")

    p = users_sub.add_parser("reset-password", help="Set new password and revoke sessions")
    p.add_argument("username")

    # sessions
    sessions_p = sub.add_parser("sessions", help="Manage sessions")
    sessions_sub = sessions_p.add_subparsers(dest="action", metavar="ACTION")
    sessions_sub.add_parser("list",  help="List active sessions")
    sessions_sub.add_parser("purge", help="Delete expired sessions")

    args = parser.parse_args()

    dispatch = {
        ("users",    "list"):           cmd_users_list,
        ("users",    "create"):         cmd_users_create,
        ("users",    "delete"):         cmd_users_delete,
        ("users",    "disable"):        cmd_users_disable,
        ("users",    "enable"):         cmd_users_enable,
        ("users",    "reset-password"): cmd_users_reset_password,
        ("sessions", "list"):           cmd_sessions_list,
        ("sessions", "purge"):          cmd_sessions_purge,
    }

    fn = dispatch.get((args.resource, getattr(args, "action", None)))
    if not fn:
        parser.print_help()
        sys.exit(1)
    fn(args)


if __name__ == "__main__":
    main()
