"""Contexta Agent — CLI entry point.

Usage
-----
Translate a span (JSON from stdin):
    echo '{"selected_span_en":"manifest time","target_sentence_en":"..."}' |
        python -m agent.run translate

Translate a span (JSON as argument):
    python -m agent.run translate '{"selected_span_en":"to name","target_sentence_en":"..."}'

Check backend health:
    python -m agent.run health

Run as a local HTTP server (web interface can call http://localhost:8001):
    python -m agent.run serve
    python -m agent.run serve --port 8002

Environment variables (loaded from .env):
    BACKEND_URL   backend base URL
    API_KEY       Bearer API key (also accepts BACKEND_KEY)
"""
from __future__ import annotations

import asyncio
import json
import logging
import sys

from . import config

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("agent.run")


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def cmd_translate(args: list[str]) -> None:
    """Run the translate skill and print the result as JSON."""
    if args:
        try:
            input_data = json.loads(args[0])
        except json.JSONDecodeError as e:
            print(f"Error: invalid JSON argument — {e}", file=sys.stderr)
            sys.exit(1)
    else:
        raw = sys.stdin.read().strip()
        if not raw:
            print(
                "Error: provide JSON as argument or via stdin.\n"
                'Example: python -m agent.run translate \'{"selected_span_en":"to name"}\'',
                file=sys.stderr,
            )
            sys.exit(1)
        try:
            input_data = json.loads(raw)
        except json.JSONDecodeError as e:
            print(f"Error: invalid JSON input — {e}", file=sys.stderr)
            sys.exit(1)

    async def _run() -> dict:
        from .agent import Agent
        async with Agent(config.BACKEND_URL, config.API_KEY) as agent:
            return await agent.run("translate", input_data)

    result = asyncio.run(_run())
    print(json.dumps(result, ensure_ascii=False, indent=2))


def cmd_health(args: list[str]) -> None:
    """Check backend health."""
    async def _run() -> dict:
        from .agent import Agent
        async with Agent(config.BACKEND_URL, config.API_KEY) as agent:
            return await agent.health()

    result = asyncio.run(_run())
    print(json.dumps(result, ensure_ascii=False, indent=2))


def cmd_serve(args: list[str]) -> None:
    """Start the local agent HTTP server."""
    port = 8001
    i = 0
    while i < len(args):
        if args[i] in ("--port", "-p") and i + 1 < len(args):
            try:
                port = int(args[i + 1])
            except ValueError:
                print(f"Error: invalid port {args[i+1]!r}", file=sys.stderr)
                sys.exit(1)
            i += 2
        else:
            i += 1

    try:
        from .server import run_server
    except ImportError as e:
        print(
            f"Error: server mode requires fastapi + uvicorn — {e}\n"
            "Install with: pip install fastapi uvicorn",
            file=sys.stderr,
        )
        sys.exit(1)

    run_server(backend_url=config.BACKEND_URL, api_key=config.API_KEY, port=port)


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

COMMANDS = {
    "translate": cmd_translate,
    "health": cmd_health,
    "serve": cmd_serve,
}


def main() -> None:
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        sys.exit(0)

    cmd = args[0]
    if cmd not in COMMANDS:
        print(
            f"Unknown command {cmd!r}. Available: {list(COMMANDS)}",
            file=sys.stderr,
        )
        sys.exit(1)

    COMMANDS[cmd](args[1:])


if __name__ == "__main__":
    main()
