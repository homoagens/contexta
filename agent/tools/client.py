"""HTTP client per il backend / API esterne.

Provider selezionato da LLM_PROVIDER nel .env:
  "local"     → POST /llm sul backend self-hosted (default, gratuito)
  "anthropic" → Anthropic API (richiede ANTHROPIC_API_KEY)
  "openai"    → OpenAI API   (richiede OPENAI_API_KEY)

Il lookup deterministico (/tools/lookup) è disponibile solo con backend locale.
"""
from __future__ import annotations

import json as _json
import logging
import re as _re
from typing import Any, Dict, List, Optional

import httpx

# Strip <think>...</think> blocks that reasoning models (qwen3, DeepSeek-R1,
# QwQ) sometimes emit even when reasoning_effort is not requested.
_THINK_RE = _re.compile(r"<think>.*?</think>", _re.DOTALL)

from .. import config
from ..schemas import LookupResult

log = logging.getLogger("agent.tools.client")


class BackendClient:
    """Client HTTP — locale o API esterna, pilotato da config.LLM_PROVIDER."""

    def __init__(self, base_url: str, api_key: str, timeout: float = 120.0):
        self.base_url = base_url.rstrip("/")
        headers: Dict[str, str] = {}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        self._client = httpx.AsyncClient(timeout=timeout, headers=headers)
        log.info("BackendClient — provider=%s", config.LLM_PROVIDER)

    # ── Context manager ────────────────────────────────────────────────────────

    async def close(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "BackendClient":
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()

    # ── LLM ───────────────────────────────────────────────────────────────────

    async def llm(
        self,
        messages: List[Dict[str, str]],
        *,
        temperature: float = 0.1,
        top_p: float = 0.9,
        max_tokens: int = 2048,
        json_mode: bool = False,
        reasoning_effort: Optional[str] = None,
        model_override: str = "",
    ) -> str:
        # Per-request model override (from frontend model selector)
        if model_override:
            if model_override.startswith("claude-"):
                return await self._llm_anthropic(
                    messages, temperature, max_tokens, model=model_override
                )
            if model_override.startswith("gpt-") or model_override.startswith("openai/"):
                return await self._llm_openai(
                    messages, temperature, max_tokens, json_mode
                )
            # local model name ("local" = default, or explicit e.g. "qwen3-8b")
            local_model = "" if model_override == "local" else model_override
            return await self._llm_local(
                messages, temperature, top_p, max_tokens, json_mode, reasoning_effort,
                model=local_model,
            )
        if config.LLM_PROVIDER == "anthropic":
            return await self._llm_anthropic(messages, temperature, max_tokens)
        if config.LLM_PROVIDER == "openai":
            return await self._llm_openai(messages, temperature, max_tokens, json_mode)
        return await self._llm_local(
            messages, temperature, top_p, max_tokens, json_mode, reasoning_effort
        )

    async def _llm_local(
        self, messages, temperature, top_p, max_tokens, json_mode, reasoning_effort,
        model: str = "",
    ) -> str:
        payload: Dict[str, Any] = {
            "messages": messages,
            "temperature": temperature,
            "top_p": top_p,
            "max_tokens": max_tokens,
            "json_mode": json_mode,
            # Disable qwen3 thinking mode.
            # llama.cpp reads "enable_thinking" from chat_template_kwargs;
            # "reasoning_budget": 0 is the numeric equivalent.
            # Rout may or may not forward these — the prompt-level /no_think
            # in the user message is the reliable fallback (see prompts.py).
            "chat_template_kwargs": {"enable_thinking": False},
            "reasoning_budget": 0,
        }
        if reasoning_effort is not None:
            payload["reasoning_effort"] = reasoning_effort
        if model:
            payload["model"] = model
        elif config.LOCAL_MODEL_NAME:
            payload["model"] = config.LOCAL_MODEL_NAME
        r = await self._client.post(f"{self.base_url}/llm", json=payload)
        r.raise_for_status()
        text = r.json().get("text", "")
        return _THINK_RE.sub("", text).strip()

    async def _llm_anthropic(self, messages, temperature, max_tokens, model: str = "") -> str:
        if not config.ANTHROPIC_API_KEY:
            raise RuntimeError("ANTHROPIC_API_KEY non configurata nel .env")
        import anthropic  # pip install anthropic  (solo se LLM_PROVIDER=anthropic)
        system_msgs = [m["content"] for m in messages if m["role"] == "system"]
        user_msgs   = [m for m in messages if m["role"] != "system"]
        kwargs: Dict[str, Any] = dict(
            model=model or config.ANTHROPIC_MODEL,
            max_tokens=max_tokens,
            messages=user_msgs,
            temperature=temperature,
        )
        if system_msgs:
            kwargs["system"] = system_msgs[0]
        ac = anthropic.AsyncAnthropic(api_key=config.ANTHROPIC_API_KEY)
        r = await ac.messages.create(**kwargs)
        return r.content[0].text

    async def _llm_openai(self, messages, temperature, max_tokens, json_mode) -> str:
        if not config.OPENAI_API_KEY:
            raise RuntimeError("OPENAI_API_KEY non configurata nel .env")
        import openai  # pip install openai  (solo se LLM_PROVIDER=openai)
        kwargs: Dict[str, Any] = dict(
            model=config.OPENAI_MODEL,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
        )
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        oc = openai.AsyncOpenAI(api_key=config.OPENAI_API_KEY)
        r = await oc.chat.completions.create(**kwargs)
        return r.choices[0].message.content

    async def llm_stream(
        self,
        messages: List[Dict[str, str]],
        *,
        temperature: float = 0.1,
        top_p: float = 0.9,
        max_tokens: int = 2048,
        reasoning_effort: Optional[str] = None,
        model_override: str = "",
    ):
        """Yield text deltas from a streaming LLM call (local backend only).

        Calls /v1/chat/completions with stream=True (OpenAI SSE format).
        Each yielded value is a raw text chunk (str). Only works with the
        local provider; raises NotImplementedError for external providers.
        """
        if config.LLM_PROVIDER != "local":
            raise NotImplementedError("Streaming is only supported with the local provider")

        model_name = (
            model_override if model_override and model_override != "local"
            else config.LOCAL_MODEL_NAME
        )
        # Base payload — same keys as /llm so rout understands it.
        # Include all known no-think flags; rout/llama.cpp honours whichever it knows.
        base_payload: Dict[str, Any] = {
            "model": model_name,
            "messages": messages,
            "temperature": temperature,
            "top_p": top_p,
            "max_tokens": max_tokens,
            "json_mode": False,
            "chat_template_kwargs": {"enable_thinking": False},
            "reasoning_budget": 0,
        }
        if reasoning_effort is not None:
            base_payload["reasoning_effort"] = reasoning_effort

        stream_payload = {**base_payload, "stream": True}
        # Blocking fallback payload must NOT include stream:True
        block_payload = {**base_payload}

        # Try /llm/stream first (SSE response, same format as blocking /llm).
        # Falls back to blocking /llm on 404 — no visual streaming but works correctly.
        stream_timeout = httpx.Timeout(connect=10.0, read=300.0, write=30.0, pool=30.0)
        try:
            async with self._client.stream(
                "POST", f"{self.base_url}/llm/stream",
                json=stream_payload, timeout=stream_timeout,
            ) as r:
                if r.status_code == 404:
                    raise httpx.HTTPStatusError("404", request=r.request, response=r)
                r.raise_for_status()
                async for line in r.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data_str = line[6:].strip()
                    if data_str == "[DONE]":
                        break
                    try:
                        chunk = _json.loads(data_str)
                        choices = chunk.get("choices") or []
                        if choices:
                            delta = choices[0].get("delta") or {}
                            text = delta.get("content") or ""
                        else:
                            text = chunk.get("text") or ""
                        if text:
                            yield text
                    except (_json.JSONDecodeError, IndexError, KeyError):
                        continue
        except httpx.HTTPStatusError as e:
            if e.response.status_code != 404:
                raise
            log.debug("llm_stream: /llm/stream not available, falling back to /llm")
            r2 = await self._client.post(
                f"{self.base_url}/llm", json=block_payload,
                timeout=stream_timeout,
            )
            r2.raise_for_status()
            text = r2.json().get("text", "")
            text = _THINK_RE.sub("", text).strip()
            if text:
                yield text

    # ── Lookup ────────────────────────────────────────────────────────────────

    async def lookup(
        self, span: str, source_lang: str = "en", target_lang: str = "it"
    ) -> Optional[LookupResult]:
        """Lookup deterministico — solo con backend locale; None altrimenti."""
        if config.LLM_PROVIDER != "local":
            return None
        r = await self._client.post(
            f"{self.base_url}/tools/lookup",
            json={"span": span, "source_lang": source_lang, "target_lang": target_lang},
        )
        r.raise_for_status()
        data = r.json()
        if data.get("type") == "none":
            return None
        return LookupResult(
            type=data["type"],
            preferred=data.get("preferred", False),
            target_lemmas=data.get("target_lemmas", []),
            definitions=data.get("definitions", []),
            examples=data.get("examples", []),
        )

    # ── Health ────────────────────────────────────────────────────────────────

    async def health(self) -> Dict[str, Any]:
        if config.LLM_PROVIDER != "local":
            model = (config.ANTHROPIC_MODEL if config.LLM_PROVIDER == "anthropic"
                     else config.OPENAI_MODEL)
            return {"ok": True, "provider": config.LLM_PROVIDER, "model": model}
        r = await self._client.get(f"{self.base_url}/health")
        r.raise_for_status()
        return r.json()
