#!/usr/bin/env bash
# Contexta — management console
# Run from anywhere: bash /path/to/manage.sh

set -euo pipefail

# Repo root is the parent of scripts/ — that's where .venv and agent/ live.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PYTHON="${PYTHON:-$ROOT_DIR/.venv/bin/python3}"
MGR="$PYTHON -m agent.manage"

# Colors
R='\033[0;31m'  # red
G='\033[0;32m'  # green
Y='\033[1;33m'  # yellow
B='\033[0;34m'  # blue
C='\033[0;36m'  # cyan
W='\033[1;37m'  # white bold
N='\033[0m'     # reset

# ─── helpers ──────────────────────────────────────────────────────────────────

header() {
    clear
    echo -e "${C}╔══════════════════════════════════════╗${N}"
    echo -e "${C}║      Contexta — Management Console   ║${N}"
    echo -e "${C}╚══════════════════════════════════════╝${N}"
    echo
}

pause() {
    echo
    read -rp "Press Enter to continue…"
}

require_username() {
    read -rp "Username: " USERNAME
    if [[ -z "$USERNAME" ]]; then
        echo -e "${R}Error: username cannot be empty.${N}"
        pause
        return 1
    fi
}

# ─── user commands ────────────────────────────────────────────────────────────

menu_users_list() {
    header
    echo -e "${W}Users${N}"
    echo
    $MGR users list
    pause
}

menu_users_create() {
    header
    echo -e "${W}Create user${N}"
    echo
    require_username || return
    $MGR users create "$USERNAME"
    pause
}

menu_users_delete() {
    header
    echo -e "${W}Delete user${N}"
    echo
    $MGR users list
    echo
    require_username || return
    $MGR users delete "$USERNAME"
    pause
}

menu_users_disable() {
    header
    echo -e "${W}Disable user${N}"
    echo
    $MGR users list
    echo
    require_username || return
    $MGR users disable "$USERNAME"
    pause
}

menu_users_enable() {
    header
    echo -e "${W}Enable user${N}"
    echo
    $MGR users list
    echo
    require_username || return
    $MGR users enable "$USERNAME"
    pause
}

menu_users_reset_password() {
    header
    echo -e "${W}Reset password${N}"
    echo
    $MGR users list
    echo
    require_username || return
    $MGR users reset-password "$USERNAME"
    pause
}

# ─── session commands ─────────────────────────────────────────────────────────

menu_sessions_list() {
    header
    echo -e "${W}Active sessions${N}"
    echo
    $MGR sessions list
    pause
}

menu_sessions_purge() {
    header
    echo -e "${W}Purge expired sessions${N}"
    echo
    $MGR sessions purge
    pause
}

# ─── menus ────────────────────────────────────────────────────────────────────

menu_users() {
    while true; do
        header
        echo -e "${W}Users${N}"
        echo
        echo -e "  ${Y}1${N}  List users"
        echo -e "  ${Y}2${N}  Create user"
        echo -e "  ${Y}3${N}  Delete user"
        echo -e "  ${Y}4${N}  Disable user"
        echo -e "  ${Y}5${N}  Enable user"
        echo -e "  ${Y}6${N}  Reset password"
        echo -e "  ${Y}0${N}  Back"
        echo
        read -rp "Choice: " CHOICE
        case "$CHOICE" in
            1) menu_users_list ;;
            2) menu_users_create ;;
            3) menu_users_delete ;;
            4) menu_users_disable ;;
            5) menu_users_enable ;;
            6) menu_users_reset_password ;;
            0) return ;;
            *) echo -e "${R}Invalid choice.${N}"; sleep 1 ;;
        esac
    done
}

menu_sessions() {
    while true; do
        header
        echo -e "${W}Sessions${N}"
        echo
        echo -e "  ${Y}1${N}  List active sessions"
        echo -e "  ${Y}2${N}  Purge expired sessions"
        echo -e "  ${Y}0${N}  Back"
        echo
        read -rp "Choice: " CHOICE
        case "$CHOICE" in
            1) menu_sessions_list ;;
            2) menu_sessions_purge ;;
            0) return ;;
            *) echo -e "${R}Invalid choice.${N}"; sleep 1 ;;
        esac
    done
}

menu_main() {
    while true; do
        header
        echo -e "  ${Y}1${N}  Users"
        echo -e "  ${Y}2${N}  Sessions"
        echo -e "  ${Y}0${N}  Exit"
        echo
        read -rp "Choice: " CHOICE
        case "$CHOICE" in
            1) menu_users ;;
            2) menu_sessions ;;
            0) echo -e "${G}Bye.${N}"; exit 0 ;;
            *) echo -e "${R}Invalid choice.${N}"; sleep 1 ;;
        esac
    done
}

# ─── entry point ──────────────────────────────────────────────────────────────

# Allow direct commands without the interactive menu:
#   bash manage.sh users list
#   bash manage.sh users create mario
#   bash manage.sh sessions purge
if [[ $# -ge 1 ]]; then
    $MGR "$@"
    exit $?
fi

menu_main
