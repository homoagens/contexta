"""Prompt builders — parameterised for any language pair + same-language synonym mode.

Runs entirely client-side in the agent. The backend only sees the
final messages list it receives via POST /llm.
"""
from __future__ import annotations

import json
from typing import Dict, Optional

# Prepend to every user message to engage qwen3 non-thinking mode.
# The tokenizer maps this to <|no_think|> regardless of backend middleware.
_NO_THINK = "/no_think\n"


# ---------------------------------------------------------------------------
# Language names (ISO 639-1 → display name)
# ---------------------------------------------------------------------------

_LANG_NAMES: dict[str, str] = {
    "en": "English",
    "it": "Italian",
    "es": "Spanish",
    "de": "German",
    "fr": "French",
}


def lang_name(code: str) -> str:
    return _LANG_NAMES.get(code, code.upper())


# ---------------------------------------------------------------------------
# System prompts — translation vs synonym
# ---------------------------------------------------------------------------

def _system_translate(source: str, target: str) -> str:
    src = lang_name(source)
    tgt = lang_name(target)
    return (
        f"You are a {src}-to-{tgt} translator. Output ONLY a raw JSON object — no markdown, no prose.\n"
        f"The user sends a JSON object with a 'span' field (the word or phrase to translate) "
        f"and a 'sentence' field (the surrounding sentence for context).\n"
        f"Required keys: best_result, span_role, span_sense, alt, sentence.\n"
        f"Rules:\n"
        f"- best_result = the {tgt} translation of the value in the 'span' field (1–3 words, NEVER a full sentence).\n"
        f"- span_role = grammatical role of the span value: one of VERB NOUN ADJ ADV PROPER_NOUN LABEL UNKNOWN\n"
        f"- span_sense = what the span value means in this context, written in {tgt} (1 sentence).\n"
        f"- alt = array of up to 2 alternative {tgt} translations of the span value (can be empty).\n"
        f"- sentence = REQUIRED. Translate the entire 'sentence' field into {tgt}. "
        f"If sentence is just one word, write a short {tgt} example sentence using best_result. "
        f"This field must never be empty or omitted.\n"
        f"- Use only real standard {tgt} words. Never invent words.\n"
        f"Output format (fill in real values):\n"
        f'{{"best_result":"...","span_role":"...","span_sense":"...","alt":["..."],"sentence":"..."}}'
    )


def _system_synonym(language: str) -> str:
    lang = lang_name(language)
    return (
        f"You are a {lang} contextual thesaurus. "
        f"The user sends a JSON with a 'span' field (the selected word/phrase) "
        f"and a 'sentence' field (the context sentence).\n"
        f"Respond with ONLY a raw JSON object — no markdown, no prose.\n"
        f"Keys: best_result, span_role (VERB|NOUN|ADJ|ADV|PROPER_NOUN|LABEL|UNKNOWN), "
        f"span_sense, alt (array max 3), sentence.\n"
        f"Rules:\n"
        f"- best_result is the BEST contextual synonym for the value in the 'span' field — "
        f"a DIFFERENT word, not the original word itself.\n"
        f"- span_sense explains the meaning of the value in the 'span' field in this context, "
        f"written in {lang}.\n"
        f"- alt contains up to 3 alternative synonyms for the span value.\n"
        f"- sentence = the original sentence with the span value replaced by best_result.\n"
        f"- All output MUST be in {lang}. Use only real standard {lang} words."
    )


def _system_minimal(source: str, target: str) -> str:
    if source == target:
        lang = lang_name(source)
        return (
            f"Find the best {lang} synonym for the given word in context. "
            f'Output ONLY this JSON (no markdown):\n'
            f'{{"best_result":"...","span_role":"...","span_sense":"...","alt":["..."],"sentence":"..."}}'
        )
    tgt = lang_name(target)
    return (
        f"Translate the span to {tgt}. "
        f'Output ONLY this JSON (no markdown):\n'
        f'{{"best_result":"...","span_role":"...","span_sense":"...","alt":["..."],"sentence":"..."}}'
    )


# ---------------------------------------------------------------------------
# User object builder
# ---------------------------------------------------------------------------

def _build_user_obj(payload: Dict) -> dict:
    span = payload.get("selected_span", "")
    sentence = payload.get("target_sentence", "") or span
    ctx_before = payload.get("context_before", "")
    ctx_after = payload.get("context_after", "")

    user_obj: dict = {"span": span, "sentence": sentence}
    if ctx_before:
        user_obj["ctx_before"] = ctx_before
    if ctx_after:
        user_obj["ctx_after"] = ctx_after
    return user_obj


# ---------------------------------------------------------------------------
# Chat context prompt builder
# ---------------------------------------------------------------------------

def build_chat_context_messages(
    translation_result: dict,
    question: str,
    constrained: bool = True,
) -> list[dict]:
    """Build messages for a contextual follow-up question on a translation."""
    source_lang = translation_result.get("source_lang", "en")
    target_lang = translation_result.get("target_lang", "it")
    src = lang_name(source_lang)
    tgt = lang_name(target_lang)

    span = translation_result.get("selected_span") or translation_result.get("selected_span_en") or ""
    best = translation_result.get("best_result") or translation_result.get("best_span_it") or ""
    sense = translation_result.get("span_sense") or translation_result.get("span_sense_en") or ""
    sentence = translation_result.get("improved_sentence") or translation_result.get("improved_target_sentence_it") or ""
    role = translation_result.get("span_role") or ""
    mode = translation_result.get("mode", "translate")

    if mode == "synonym":
        context_str = (
            f'Word: "{span}" ({src})\n'
            f'Part of speech: {role}\n'
            f'Best synonym: "{best}"\n'
            f'Meaning: {sense}\n'
            f'Example: {sentence}'
        )
    else:
        context_str = (
            f'Word/phrase: "{span}" ({src})\n'
            f'Part of speech: {role}\n'
            f'Translation: "{best}" ({tgt})\n'
            f'Meaning: {sense}\n'
            f'Example sentence: {sentence}'
        )

    if constrained:
        system = (
            f"TASK: {question}\n\n"
            f"Context about the word:\n{context_str}\n\n"
            f"Instructions:\n"
            f"- Answer in {tgt}.\n"
            f"- Complete ONLY the task above — do not explain the word in general.\n"
            f"- Maximum 4 sentences total.\n"
            f"- Write plain text: no asterisks, no bold, no markdown, no headers.\n"
            f"- Start directly with the answer — no 'Okay', 'Certo', 'Ecco' or similar."
        )
    else:
        system = (
            f"You are a helpful language assistant. Answer in {tgt}.\n"
            f"The user is reading a {src} text and previously looked up this word "
            f"(use as background only if relevant):\n{context_str}\n\n"
            f"Instructions:\n"
            f"- Answer the user's question freely and directly.\n"
            f"- Write plain text: no asterisks, no bold, no markdown, no headers.\n"
            f"- Start directly with the answer — no 'Okay', 'Certo', 'Ecco' or similar."
        )

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": question},
    ]


# ---------------------------------------------------------------------------
# Message builders
# ---------------------------------------------------------------------------

def build_translate_messages(
    payload: Dict,
    source_lang: str = "en",
    target_lang: str = "it",
) -> list[dict]:
    """Standard prompt — used on first attempt."""
    if source_lang == target_lang:
        system = _system_synonym(source_lang)
    else:
        system = _system_translate(source_lang, target_lang)
    user_msg = _NO_THINK + json.dumps(_build_user_obj(payload), ensure_ascii=False)
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user_msg},
    ]


def build_translate_messages_minimal(
    payload: Dict,
    source_lang: str = "en",
    target_lang: str = "it",
) -> list[dict]:
    """Minimal prompt for retry when reasoning exhausted all tokens on attempt 1."""
    user_obj = {
        "span": payload.get("selected_span", ""),
        "sentence": payload.get("target_sentence", "") or payload.get("selected_span", ""),
    }
    return [
        {"role": "system", "content": _system_minimal(source_lang, target_lang)},
        {"role": "user", "content": _NO_THINK + json.dumps(user_obj, ensure_ascii=False)},
    ]


def _kb_context(kb: dict, up_to_chapter: Optional[int]) -> str:
    """Render a book KB as a plain-text context block, spoiler-safe."""
    summary = str(kb.get("summary") or "").strip()
    themes = ", ".join(str(t) for t in (kb.get("themes") or []))
    chars = "\n".join(
        f"- {c.get('name','')}: {c.get('description','')}"
        for c in (kb.get("characters") or []) if c.get("name")
    )
    chapters = kb.get("chapters") or []
    if up_to_chapter is not None:
        chapters = [c for c in chapters if int(c.get("index", 0)) <= up_to_chapter]
    chap_text = "\n".join(
        f"Ch.{int(c.get('index',0))+1} {c.get('title','')}: {c.get('summary','')}".strip()
        for c in chapters
    )
    parts = []
    if summary:   parts.append(f"BOOK SUMMARY:\n{summary}")
    if themes:    parts.append(f"THEMES: {themes}")
    if chars:     parts.append(f"CHARACTERS:\n{chars}")
    if chap_text: parts.append(f"CHAPTERS THE READER HAS REACHED:\n{chap_text}")
    return "\n\n".join(parts)


def build_book_chat_messages(
    kb: dict,
    question: str,
    persona: bool = False,
    up_to_chapter: Optional[int] = None,
    target_lang: str = "it",
) -> list[dict]:
    """Messages for contextual chat about a book.

    persona=True → the agent answers in the voice of the book itself.
    up_to_chapter limits the context to avoid spoilers.
    """
    tgt = lang_name(target_lang)
    context = _kb_context(kb, up_to_chapter)
    if persona:
        system = (
            f"You ARE this book. Speak in the first person, as the book's "
            f"narrator, staying in character and within the book's world.\n"
            f"Answer the reader's question in {tgt}. Use ONLY the context below.\n"
            f"Never reveal events beyond the chapters the reader has reached.\n"
            f"Plain text, no markdown.\n\n{context}"
        )
    else:
        system = (
            f"You are a literary reading companion. Answer the reader's "
            f"question about this book using ONLY the context below.\n"
            f"Answer in {tgt}, plain text, concise (max 5 sentences).\n"
            f"Never reveal events beyond the chapters the reader has reached.\n"
            f"If the context does not contain the answer, say so honestly.\n\n{context}"
        )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": question},
    ]


def build_chapter_summary_messages(title: str, text: str) -> list[dict]:
    """Messages to summarize a single chapter and list its characters."""
    system = (
        "You are a literary analyst. The user sends one chapter of a book.\n"
        "Output ONLY a raw JSON object — no markdown, no prose.\n"
        "Keys:\n"
        "- summary  = a 2-sentence summary of what happens in the chapter.\n"
        "- characters = array of names of characters who appear (may be empty).\n"
        'Format: {"summary":"...","characters":["..."]}'
    )
    head = f"Chapter title: {title}\n\n" if title else ""
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": head + text[:6000]},
    ]


def build_kb_consolidation_messages(chapter_summaries: list[str]) -> list[dict]:
    """Messages to consolidate chapter summaries into a whole-book KB."""
    system = (
        "You are a literary analyst. The user sends an ordered list of "
        "chapter summaries from one book.\n"
        "Output ONLY a raw JSON object — no markdown, no prose.\n"
        "Keys:\n"
        "- summary    = one-paragraph summary of the whole book.\n"
        "- themes     = array of 3-5 central themes (short phrases).\n"
        "- characters = array of {name, description} — the main characters, "
        "each with a one-line description.\n"
        'Format: {"summary":"...","themes":["..."],'
        '"characters":[{"name":"...","description":"..."}]}'
    )
    joined = "\n".join(f"{i+1}. {s}" for i, s in enumerate(chapter_summaries))
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": joined[:12000]},
    ]


def build_batch_translate_messages(
    items: list[dict],
    source_lang: str = "en",
    target_lang: str = "it",
) -> list[dict]:
    """Build messages to translate many spans in a single call.

    Used to pre-warm the translation cache for a whole page. Each item is
    {span, sentence}; the model must echo `span` so results can be matched
    back even if the order shifts.
    """
    src = lang_name(source_lang)
    tgt = lang_name(target_lang)
    same = source_lang == target_lang
    task = (
        f"best {tgt} contextual synonym" if same
        else f"{tgt} translation"
    )
    system = (
        f"You are a {src}-to-{tgt} {'thesaurus' if same else 'translator'}. "
        f"The user sends a JSON array of items, each with a 'span' "
        f"(word/phrase) and a 'sentence' (its context).\n"
        f"For EVERY item output one JSON object with keys: "
        f"span, best_result, span_role, span_sense.\n"
        f"Rules:\n"
        f"- span = echo the input span EXACTLY (so results can be matched).\n"
        f"- best_result = the {task} of the span value (1-3 words, never a sentence).\n"
        f"- span_role = one of VERB NOUN ADJ ADV PROPER_NOUN LABEL UNKNOWN\n"
        f"- span_sense = what the span means in this context, in {tgt} (1 short sentence).\n"
        f"- Use only real standard {tgt} words. Never invent words.\n"
        f"Output ONLY a raw JSON array, same length and order as the input. "
        f"No markdown, no prose.\n"
        f'Format: [{{"span":"...","best_result":"...","span_role":"...","span_sense":"..."}}]'
    )
    user_msg = json.dumps(
        [{"span": it.get("span", ""), "sentence": it.get("sentence", "")}
         for it in items],
        ensure_ascii=False,
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user_msg},
    ]


def build_translate_messages_with_hints(
    payload: Dict,
    hints: Optional[dict],
    source_lang: str = "en",
    target_lang: str = "it",
) -> list[dict]:
    """Enriched prompt — adds lookup hints to anchor the model on real words.

    Two modes depending on hint source:
    - Idiom dict (hints['preferred']=True): prescribe best_result directly.
    - WordNet (no 'preferred'): add as suggestions only (dictionary_hints).

    Falls back to standard prompt if hints is None or empty.
    """
    if not hints:
        return build_translate_messages(payload, source_lang, target_lang)

    # Choose the right system prompt
    if source_lang == target_lang:
        system = _system_synonym(source_lang)
    else:
        system = _system_translate(source_lang, target_lang)

    user_obj = _build_user_obj(payload)

    if hints.get("preferred"):
        # Idiom hit: prescribe the translation
        lemmas = hints.get("target_lemmas", [])
        if lemmas:
            user_obj["preferred_translation"] = lemmas[0]
            user_obj["preferred_translation_note"] = (
                "This is a known fixed idiom. Use preferred_translation as best_result."
            )
            alts = lemmas[1:3]
            if alts:
                user_obj["preferred_alternatives"] = alts
    else:
        # WordNet hints: add as suggestions only
        h: dict = {}
        if hints.get("definitions"):
            h["definitions"] = hints["definitions"][:2]
        if hints.get("target_lemmas"):
            label = "synonyms" if source_lang == target_lang else "target_lemmas"
            h[label] = hints["target_lemmas"][:4]
        if hints.get("examples"):
            h["examples"] = hints["examples"][:1]
        if h:
            user_obj["dictionary_hints"] = h

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": _NO_THINK + json.dumps(user_obj, ensure_ascii=False)},
    ]
