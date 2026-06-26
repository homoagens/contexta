"""JSON parsing utilities — ported from backend/app/llm_client.py.

Handles the messy output that reasoning/chat models sometimes produce:
markdown code fences, trailing commas, reasoning_content fallback, etc.
"""
from __future__ import annotations

import re
import json
from typing import Any, Dict, List


def _fix_common_json_issues(raw: str) -> str:
    """Fix common LLM JSON mistakes before parsing."""
    # Remove markdown code fences
    raw = re.sub(r"^```(?:json)?\s*\n?", "", raw, flags=re.MULTILINE)
    raw = re.sub(r"\n?```\s*$", "", raw, flags=re.MULTILINE)
    # Remove trailing commas before } or ]
    raw = re.sub(r",\s*([}\]])", r"\1", raw)
    return raw.strip()


def parse_json_object(raw: str) -> Dict[str, Any]:
    """Parse a JSON object from potentially messy LLM output.

    Attempts in order:
    1. Direct parse
    2. Parse after fixing code fences + trailing commas
    3. Brace-matching extraction (handles leading prose)

    Returns an empty dict if all attempts fail.
    """
    raw = (raw or "").strip()
    if not raw:
        return {}

    # Attempt 1: direct parse
    try:
        obj = json.loads(raw)
        return obj if isinstance(obj, dict) else {}
    except Exception:
        pass

    # Attempt 2: fix common issues
    fixed = _fix_common_json_issues(raw)
    try:
        obj = json.loads(fixed)
        return obj if isinstance(obj, dict) else {}
    except Exception:
        pass

    # Attempt 3: brace-matching extraction
    i0 = fixed.find("{")
    if i0 < 0:
        return {}

    depth = 0
    in_str = False
    esc = False
    for i in range(i0, len(fixed)):
        ch = fixed[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        else:
            if ch == '"':
                in_str = True
                continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    candidate = fixed[i0:i + 1]
                    for attempt in (candidate, re.sub(r",\s*([}\]])", r"\1", candidate)):
                        try:
                            obj = json.loads(attempt)
                            if isinstance(obj, dict):
                                return obj
                        except Exception:
                            continue
                    return {}
    return {}


def parse_json_array(raw: str) -> List[Dict[str, Any]]:
    """Parse a JSON array of objects from messy LLM output.

    Accepts a bare array `[{...}, {...}]` or a wrapper object
    `{"results": [...]}` / `{"items": [...]}`. Returns [] on failure.
    """
    raw = (raw or "").strip()
    if not raw:
        return []

    def _coerce(value: Any) -> List[Dict[str, Any]]:
        if isinstance(value, list):
            return [x for x in value if isinstance(x, dict)]
        if isinstance(value, dict):
            for key in ("results", "items", "translations", "data"):
                if isinstance(value.get(key), list):
                    return [x for x in value[key] if isinstance(x, dict)]
        return []

    # Attempt 1 + 2: direct / fixed parse
    for candidate in (raw, _fix_common_json_issues(raw)):
        try:
            return _coerce(json.loads(candidate))
        except Exception:
            pass

    # Attempt 3: extract the first balanced [...] block
    fixed = _fix_common_json_issues(raw)
    i0 = fixed.find("[")
    if i0 < 0:
        return []
    depth = 0
    in_str = False
    esc = False
    for i in range(i0, len(fixed)):
        ch = fixed[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                block = fixed[i0:i + 1]
                for attempt in (block, re.sub(r",\s*([}\]])", r"\1", block)):
                    try:
                        return _coerce(json.loads(attempt))
                    except Exception:
                        continue
                return []
    return []
