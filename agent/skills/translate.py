"""TranslateSkill — multilingual translation + same-language synonym orchestration.

This skill owns ALL the translation/synonym business logic.
The backend is just a dumb tool registry.

Workflow per request:
  1. Pre-fetch lookup (idiom dict → WordNet) via /tools/lookup
  2. Build prompt using hints if available (translate or synonym mode)
  3. Call /llm (retry loop, max MAX_RETRIES attempts)
  4. Parse + validate JSON response
  5. On failure: adapt prompt strategy (minimal / add hints) and retry
"""
from __future__ import annotations

import dataclasses
import logging
from typing import Optional

from .. import config
from .. import translation_cache as cache
from ..schemas import TranslateInput, TranslateOutput, LookupResult
from ..tools.client import BackendClient
from ..prompts import (
    build_translate_messages,
    build_translate_messages_with_hints,
    build_translate_messages_minimal,
)
from ..validator import has_hallucinated_word
from .._json import parse_json_object

log = logging.getLogger("agent_contexta.skills.translate")

DEFAULT_MAX_RETRIES = 2


class TranslateSkill:
    """Orchestrates a single translation or synonym request.

    Configuration (the "mini-config"):
      - max_retries:        how many LLM attempts before giving up
      - reasoning_effort:   passed to /llm ("low" for fast reasoning models)
      - top_p:              nucleus sampling
    """

    def __init__(
        self,
        max_retries: int = DEFAULT_MAX_RETRIES,
        reasoning_effort: Optional[str] = None,
        top_p: float = 0.9,
    ) -> None:
        self.max_retries = max_retries
        self.reasoning_effort = reasoning_effort
        self.top_p = top_p

    # ------------------------------------------------------------------
    # Main entry point
    # ------------------------------------------------------------------

    async def run(self, inp: TranslateInput, client: BackendClient) -> TranslateOutput:
        """Run the full translate/synonym workflow and return a TranslateOutput.

        Raises RuntimeError if all retry attempts fail.
        """
        source_lang = inp.source_lang
        target_lang = inp.target_lang
        mode = "synonym" if inp.is_same_language else "translate"

        # --- Step 0: cache lookup ---
        # Context-sensitive key first (precise); on miss fall back to the
        # context-free key, which the batch pre-translation skill warms.
        model_key = inp.model if inp.model and inp.model != "local" else config.LOCAL_MODEL_NAME
        cache_key = cache.make_key(
            inp.selected_span, inp.target_sentence,
            source_lang, target_lang, mode, model_key,
        )
        cached = cache.get(cache_key)
        if cached is None and inp.target_sentence.strip():
            free_key = cache.make_key(
                inp.selected_span, "", source_lang, target_lang, mode, model_key,
            )
            cached = cache.get(free_key)
        if cached is not None:
            log.info("Cache HIT for %r (%s)", inp.selected_span, mode)
            return TranslateOutput(**cached)

        payload = {
            "selected_span": inp.selected_span,
            "target_sentence": inp.target_sentence,
            "context_before": inp.context_before,
            "context_after": inp.context_after,
        }

        # --- Step 1: pre-fetch lookup ---
        hints: Optional[dict] = await self._fetch_hints(
            client, inp.selected_span, source_lang, target_lang
        )

        # --- Step 2: build initial messages ---
        if hints:
            messages = build_translate_messages_with_hints(
                payload, hints, source_lang, target_lang
            )
        else:
            messages = build_translate_messages(payload, source_lang, target_lang)

        # --- Step 3: retry loop ---
        last_text = ""
        last_error: Optional[Exception] = None
        content_was_empty = False

        for attempt in range(1, self.max_retries + 1):
            try:
                # Bump temperature slightly on retries to escape bad patterns
                temp = min(inp.temperature + 0.05 * (attempt - 1), 1.0)

                # Adapt prompt strategy on retry
                if attempt > 1:
                    messages = self._retry_messages(
                        payload, hints, content_was_empty,
                        source_lang, target_lang, inp.selected_span
                    )

                text = await client.llm(
                    messages,
                    temperature=temp,
                    top_p=self.top_p,
                    max_tokens=inp.max_tokens,
                    json_mode=True,
                    reasoning_effort=self.reasoning_effort,
                    model_override=inp.model,
                )
                last_text = text
                content_was_empty = not text
                log.info(
                    "LLM response (attempt %d/%d, %d chars): %.300s",
                    attempt, self.max_retries, len(text), text,
                )

                # Parse + validate (trusted lemmas suppress false hallucination flags)
                trusted = hints.get("target_lemmas") if hints else None
                out = self._parse_and_validate(obj_text=text, inp=inp, trusted=trusted)
                # Store the validated result for future identical requests
                try:
                    cache.put(
                        cache_key, inp.selected_span,
                        source_lang, target_lang, mode,
                        dataclasses.asdict(out),
                    )
                except Exception as ce:
                    log.warning("Cache write failed (non-fatal): %s", ce)
                return out

            except Exception as e:
                last_error = e
                log.warning(
                    "Translate attempt %d/%d failed: %s | raw: %.200s",
                    attempt, self.max_retries, e, last_text,
                )
                if attempt >= self.max_retries:
                    break

        raise RuntimeError(
            f"Translate failed after {self.max_retries} attempts: {last_error}"
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _fetch_hints(
        self, client: BackendClient, span: str,
        source_lang: str, target_lang: str,
    ) -> Optional[dict]:
        """Fetch lookup hints from backend. Returns hints dict or None.

        The lookup tool is WordNet-based (English lexical database), so it is
        only meaningful when the source language is English. For any other
        source we skip the call entirely to avoid a wasted round-trip.
        """
        if source_lang != "en":
            return None
        try:
            result: Optional[LookupResult] = await client.lookup(
                span, source_lang, target_lang
            )
        except Exception as e:
            log.warning("Lookup failed for %r (non-fatal): %s", span, e)
            return None

        if result is None:
            return None

        hints = result.as_hints()
        if hints:
            log.info(
                "Pre-lookup hit (%s) for %r: target_lemmas=%s preferred=%s",
                result.type, span, result.target_lemmas, result.preferred,
            )
        return hints

    def _retry_messages(
        self,
        payload: dict,
        hints: Optional[dict],
        content_was_empty: bool,
        source_lang: str,
        target_lang: str,
        span: str,
    ) -> list[dict]:
        """Choose the right prompt strategy for a retry attempt."""
        if content_was_empty:
            log.info("Retry with minimal prompt for %r (content was empty)", span)
            return build_translate_messages_minimal(payload, source_lang, target_lang)
        elif hints:
            return build_translate_messages_with_hints(
                payload, hints, source_lang, target_lang
            )
        else:
            return build_translate_messages(payload, source_lang, target_lang)

    async def run_stream(self, inp: TranslateInput, client: BackendClient):
        """Streaming variant of run().

        Yields ("token", str) for each LLM text delta as it arrives.
        Yields ("result", TranslateOutput) as the final event.

        Cache hits bypass streaming entirely: a single ("result", ...) is
        yielded immediately. Raises RuntimeError on unrecoverable failure.
        """
        source_lang = inp.source_lang
        target_lang = inp.target_lang
        mode = "synonym" if inp.is_same_language else "translate"
        model_key = inp.model if inp.model and inp.model != "local" else config.LOCAL_MODEL_NAME

        # --- Cache lookup (same two-level strategy as run()) ---
        cache_key = cache.make_key(
            inp.selected_span, inp.target_sentence,
            source_lang, target_lang, mode, model_key,
        )
        cached = cache.get(cache_key)
        if cached is None and inp.target_sentence.strip():
            free_key = cache.make_key(
                inp.selected_span, "", source_lang, target_lang, mode, model_key,
            )
            cached = cache.get(free_key)
        if cached is not None:
            log.info("Stream cache HIT for %r (%s)", inp.selected_span, mode)
            yield ("result", TranslateOutput(**cached))
            return

        # --- Hints ---
        hints: Optional[dict] = await self._fetch_hints(
            client, inp.selected_span, source_lang, target_lang
        )

        # --- Messages ---
        payload = {
            "selected_span": inp.selected_span,
            "target_sentence": inp.target_sentence,
            "context_before": inp.context_before,
            "context_after": inp.context_after,
        }
        if hints:
            messages = build_translate_messages_with_hints(
                payload, hints, source_lang, target_lang
            )
        else:
            messages = build_translate_messages(payload, source_lang, target_lang)

        # --- Stream LLM ---
        # Split the stream into two channels:
        #   ("thinking", text) — content inside <think>...</think> (shown live in
        #                        the UI but NOT fed into the JSON parse)
        #   ("token",    text) — the real answer (accumulated for JSON parsing)
        # A rolling buffer guards against tags split across chunks.
        accumulated = ""
        in_think = False
        think_buf = ""
        try:
            async for chunk in client.llm_stream(
                messages,
                temperature=inp.temperature,
                top_p=self.top_p,
                max_tokens=inp.max_tokens,
                reasoning_effort=self.reasoning_effort,
                model_override=inp.model,
            ):
                think_buf += chunk
                while True:
                    if not in_think:
                        open_idx = think_buf.find("<think>")
                        if open_idx == -1:
                            # No opening tag — emit everything except the last 6
                            # chars (partial "<think>" guard) as answer tokens.
                            safe = think_buf[:-6] if len(think_buf) > 6 else ""
                            if safe:
                                accumulated += safe
                                yield ("token", safe)
                                think_buf = think_buf[len(safe):]
                            break
                        # Emit answer text before the opening tag
                        if open_idx > 0:
                            safe = think_buf[:open_idx]
                            accumulated += safe
                            yield ("token", safe)
                        think_buf = think_buf[open_idx + len("<think>"):]
                        in_think = True
                    else:
                        close_idx = think_buf.find("</think>")
                        if close_idx == -1:
                            # Still inside <think>: stream the safe prefix as
                            # thinking, keep an 8-char tail for a split "</think>".
                            safe = think_buf[:-8] if len(think_buf) > 8 else ""
                            if safe:
                                yield ("thinking", safe)
                                think_buf = think_buf[len(safe):]
                            break
                        # Emit the remaining thinking up to the closing tag
                        if close_idx > 0:
                            yield ("thinking", think_buf[:close_idx])
                        think_buf = think_buf[close_idx + len("</think>"):]
                        in_think = False
        except Exception as e:
            raise RuntimeError(f"LLM stream failed: {e}") from e

        # Flush whatever remains in the buffer
        if think_buf:
            if in_think:
                yield ("thinking", think_buf)
            else:
                accumulated += think_buf
                yield ("token", think_buf)

        # --- Parse + validate ---
        trusted = hints.get("target_lemmas") if hints else None
        try:
            out = self._parse_and_validate(accumulated, inp, trusted)
        except Exception as e:
            raise RuntimeError(f"Parse failed after streaming ({len(accumulated)} chars): {e}") from e

        # --- Cache ---
        try:
            cache.put(
                cache_key, inp.selected_span,
                source_lang, target_lang, mode,
                dataclasses.asdict(out),
            )
        except Exception as ce:
            log.warning("Cache write failed (non-fatal): %s", ce)

        yield ("result", out)

    def _parse_and_validate(
        self, obj_text: str, inp: TranslateInput,
        trusted: Optional[list[str]] = None,
    ) -> TranslateOutput:
        """Parse JSON text and build a validated TranslateOutput.

        Raises ValueError if the response is invalid or contains
        a hallucinated word. `trusted` lemmas suppress false positives.
        """
        obj = parse_json_object(obj_text)
        if not obj:
            raise ValueError("Model did not return valid JSON")

        # Accept multiple key names (small models use different conventions)
        best_result = str(
            obj.get("best_result") or obj.get("best_span_it") or
            obj.get("translation") or obj.get("translated") or
            obj.get("result") or obj.get("word") or obj.get("target") or ""
        ).strip()
        # Catch-all: first short string value in the dict (avoids picking up long fields)
        if not best_result:
            for v in obj.values():
                if isinstance(v, str) and v.strip() and len(v.strip().split()) <= 5:
                    best_result = v.strip()
                    log.warning("best_result not found by key — using first short value: %r", best_result)
                    break
        if not best_result:
            raise ValueError("Missing required field 'best_result'")

        if has_hallucinated_word(best_result, target_lang=inp.target_lang, trusted=trusted):
            log.warning(
                "Hallucination suspected in best_result: %r — forcing retry",
                best_result,
            )
            raise ValueError(f"Hallucination suspected: '{best_result}'")

        # Normalise / fill optional fields
        selected_span = inp.selected_span.strip()
        sent_original = (inp.target_sentence or selected_span).strip()
        normalized = (obj.get("target_sentence_normalized") or sent_original).strip()

        max_alts = 3 if inp.is_same_language else 2
        alts = obj.get("alt") or obj.get("alternatives") or []
        if isinstance(alts, str):
            alts = [alts]
        alts = [
            str(a).strip()
            for a in alts
            if str(a).strip() and str(a).strip().lower() != best_result.lower()
        ]
        alts = alts[:max_alts]

        sentence = str(
            obj.get("sentence") or obj.get("sentence_it")
            or obj.get("improved_sentence") or ""
        ).strip()

        span_sense = str(
            obj.get("span_sense") or obj.get("span_sense_en") or ""
        ).strip()

        return TranslateOutput(
            selected_span=selected_span,
            target_sentence_original=sent_original,
            target_sentence_normalized=normalized,
            best_result=best_result,
            alternatives=alts,
            span_role=str(obj.get("span_role") or "UNKNOWN").strip().upper(),
            span_sense=span_sense,
            span_confidence=obj.get("span_confidence"),
            improved_sentence=sentence,
            notes=str(obj.get("notes") or "").strip(),
            translated_by=(inp.model if inp.model and inp.model != "local" else config.MODEL_DISPLAY_NAME),
            source_lang=inp.source_lang,
            target_lang=inp.target_lang,
            mode="synonym" if inp.is_same_language else "translate",
        )
