"""BatchTranslateSkill — pre-translate many spans in one LLM call.

Purpose: warm the translation cache for a whole page so that, when the user
later taps a word, the single `/translate` request is an instant cache HIT.

Flow:
  1. Dedupe incoming items by cache key
  2. Drop items already in the cache (nothing to do)
  3. Translate the remaining misses in ONE LLM call
  4. Store each result in the cache under the same key the single-translate
     skill would use → a later tap hits it
"""
from __future__ import annotations

import dataclasses
import logging
from typing import Optional

from .. import config
from .. import translation_cache as cache
from ..schemas import TranslateOutput
from ..tools.client import BackendClient
from ..prompts import build_batch_translate_messages
from .._json import parse_json_array
from ..validator import has_hallucinated_word

log = logging.getLogger("agent.skills.batch")

# Hard cap on LLM-translated items per call (keeps the response within tokens)
MAX_ITEMS = 40


class BatchTranslateSkill:
    async def run(
        self,
        items: list[dict],
        source_lang: str,
        target_lang: str,
        model: str,
        client: BackendClient,
    ) -> dict:
        mode = "synonym" if source_lang == target_lang else "translate"
        model_key = model if model and model != "local" else config.LOCAL_MODEL_NAME

        # 1 + 2: dedupe by cache key, split hits vs misses
        seen: set[str] = set()
        misses: list[dict] = []
        hits = 0
        for it in items:
            span = (it.get("span") or "").strip()
            if not span:
                continue
            sentence = (it.get("sentence") or "").strip()
            key = cache.make_key(span, sentence, source_lang, target_lang, mode, model_key)
            if key in seen:
                continue
            seen.add(key)
            if cache.get(key) is not None:
                hits += 1
            else:
                misses.append({"span": span, "sentence": sentence, "key": key})

        if not misses:
            return {"requested": len(items), "translated": 0, "cache_hits": hits}

        misses = misses[:MAX_ITEMS]

        # 3: one LLM call for all misses
        messages = build_batch_translate_messages(
            [{"span": m["span"], "sentence": m["sentence"]} for m in misses],
            source_lang, target_lang,
        )
        try:
            text = await client.llm(
                messages,
                temperature=0.1,
                max_tokens=4096,
                json_mode=True,
                model_override=model,
            )
        except Exception as e:
            log.warning("Batch LLM call failed (non-fatal): %s", e)
            return {"requested": len(items), "translated": 0, "cache_hits": hits}

        results = parse_json_array(text)
        by_span = {
            str(r.get("span", "")).strip().lower(): r
            for r in results if isinstance(r, dict)
        }

        # 4: cache each result (match by echoed span, fall back to order)
        translated = 0
        for idx, m in enumerate(misses):
            r = by_span.get(m["span"].lower())
            if r is None and idx < len(results):
                r = results[idx]
            if not isinstance(r, dict):
                continue
            best = str(r.get("best_result") or "").strip()
            if not best or len(best.split()) > 5:
                continue
            if has_hallucinated_word(best, target_lang=target_lang):
                continue
            sent = m["sentence"] or m["span"]
            out = TranslateOutput(
                selected_span=m["span"],
                target_sentence_original=sent,
                target_sentence_normalized=sent,
                best_result=best,
                alternatives=[],
                span_role=str(r.get("span_role") or "UNKNOWN").strip().upper(),
                span_sense=str(r.get("span_sense") or "").strip(),
                span_confidence=None,
                improved_sentence="",
                notes="",
                translated_by=config.MODEL_DISPLAY_NAME,
                source_lang=source_lang,
                target_lang=target_lang,
                mode=mode,
            )
            cache.put(m["key"], m["span"], source_lang, target_lang, mode,
                      dataclasses.asdict(out))
            translated += 1

        log.info("Batch: %d requested, %d cached-hits, %d newly translated",
                 len(items), hits, translated)
        return {"requested": len(items), "translated": translated, "cache_hits": hits}
