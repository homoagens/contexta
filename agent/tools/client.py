"""HTTP client per il backend / API esterne.

Provider selezionato da LLM_PROVIDER nel .env:
  "local"     → POST /chat/completions su un endpoint OpenAI-compatibile
                (LM Studio, llama.cpp, Ollama, vLLM... default, gratuito)
  "anthropic" → Anthropic API (richiede ANTHROPIC_API_KEY)
  "openai"    → OpenAI API   (richiede OPENAI_API_KEY)

Il lookup deterministico (/tools/lookup) è un'estensione custom: se il backend
non lo espone (server OpenAI standard) si degrada alla traduzione via LLM.
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
        # Set once we learn the backend has no /tools/lookup (OpenAI-compatible
        # servers don't) — avoids a wasted 404 round-trip on every translation.
        self._lookup_unavailable = False
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
            "model": model or config.LOCAL_MODEL_NAME,
            "messages": messages,
            "temperature": temperature,
            "top_p": top_p,
            "max_tokens": max_tokens,
            # Best-effort disable of qwen3-style thinking on self-hosted servers
            # that honour it (llama.cpp/vLLM read "enable_thinking" from
            # chat_template_kwargs; "reasoning_budget": 0 is the numeric
            # equivalent). Unknown fields are ignored by other servers; the
            # model-agnostic _FAST_HINT in the system prompt is the portable
            # fallback (see prompts.py).
            "chat_template_kwargs": {"enable_thinking": False},
            "reasoning_budget": 0,
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        if reasoning_effort is not None:
            payload["reasoning_effort"] = reasoning_effort
        r = await self._client.post(f"{self.base_url}/chat/completions", json=payload)
        r.raise_for_status()
        text = r.json()["choices"][0]["message"]["content"] or ""
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

        Calls /chat/completions with stream=True (OpenAI SSE format).
        Each yielded value is a raw text chunk (str). Only works with the
        local provider; raises NotImplementedError for external providers.
        """
        if config.LLM_PROVIDER != "local":
            raise NotImplementedError("Streaming is only supported with the local provider")

        model_name = (
            model_override if model_override and model_override != "local"
            else config.LOCAL_MODEL_NAME
        )
        # OpenAI-compatible chat payload. The no-think flags are extra fields that
        # self-hosted servers (llama.cpp/vLLM) honour and OpenAI-strict servers
        # ignore; the _FAST_HINT in the system prompt is the portable fallback.
        base_payload: Dict[str, Any] = {
            "model": model_name,
            "messages": messages,
            "temperature": temperature,
            "top_p": top_p,
            "max_tokens": max_tokens,
            "chat_template_kwargs": {"enable_thinking": False},
            "reasoning_budget": 0,
        }
        if reasoning_effort is not None:
            base_payload["reasoning_effort"] = reasoning_effort

        stream_payload = {**base_payload, "stream": True}
        # Blocking fallback payload must NOT include stream:True
        block_payload = {**base_payload}

        # Try streaming /chat/completions (OpenAI SSE). Some servers don't support
        # streaming → fall back to a blocking /chat/completions call (no visual
        # streaming but correct output).
        stream_timeout = httpx.Timeout(connect=10.0, read=300.0, write=30.0, pool=30.0)
        try:
            async with self._client.stream(
                "POST", f"{self.base_url}/chat/completions",
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
                            # Some servers stream reasoning in a separate field
                            # instead of inline <think> tags — wrap it so the
                            # skill treats it as thinking (see translate.py).
                            rc = delta.get("reasoning_content") or delta.get("reasoning") or ""
                            if rc:
                                yield f"<think>{rc}</think>"
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
            log.debug("llm_stream: streaming not available, falling back to blocking call")
            r2 = await self._client.post(
                f"{self.base_url}/chat/completions", json=block_payload,
                timeout=stream_timeout,
            )
            r2.raise_for_status()
            text = r2.json()["choices"][0]["message"]["content"] or ""
            text = _THINK_RE.sub("", text).strip()
            if text:
                yield text

    # ── Lookup ────────────────────────────────────────────────────────────────

    async def lookup(
        self, span: str, source_lang: str = "en", target_lang: str = "it"
    ) -> Optional[LookupResult]:
        """Lookup deterministico — estensione custom del backend.

        Disponibile solo con provider locale e solo se il server espone
        /tools/lookup; sui server OpenAI-compatibili standard non esiste, quindi
        si degrada a None (la traduzione prosegue via LLM).
        """
        if config.LLM_PROVIDER != "local" or self._lookup_unavailable:
            return None
        try:
            r = await self._client.post(
                f"{self.base_url}/tools/lookup",
                json={"span": span, "source_lang": source_lang, "target_lang": target_lang},
            )
            r.raise_for_status()
        except (httpx.HTTPStatusError, httpx.RequestError):
            # Backend has no deterministic lookup — stop trying for this session.
            self._lookup_unavailable = True
            return None
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
        # OpenAI-compatible servers expose /models (not /health).
        try:
            r = await self._client.get(f"{self.base_url}/models")
            r.raise_for_status()
            data = r.json()
            models = [m.get("id") for m in data.get("data", []) if isinstance(m, dict)]
            return {"ok": True, "provider": "local",
                    "model": config.LOCAL_MODEL_NAME, "models": models}
        except (httpx.HTTPStatusError, httpx.RequestError) as e:
            return {"ok": False, "provider": "local",
                    "model": config.LOCAL_MODEL_NAME, "error": str(e)}
