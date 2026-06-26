"""Hallucination validator — language-aware, multi-signal.

Runs inside the agent (no server round-trip). Its job is narrow: decide
whether a single-word translation result is a real word in the target
language, so the skill can trigger a retry if it isn't.

Design priority: FEW false positives. Flagging a real word only costs one
wasted retry, but the bigger risk is annoying the user with retries on
correct results — so every signal here is conservative.

Signals, in order of trust:
  1. Trusted lemma   — the word came from the dictionary lookup → always real
  2. Spell-checker   — the word is known to pyspellchecker → real
  3. Phonotactics    — unknown word + an impossible letter pattern → hallucinated
"""
from __future__ import annotations

import logging
import re
from typing import Iterable, Optional

log = logging.getLogger("agent.validator")

# Lazy per-language SpellChecker cache
_spell_cache: dict[str, Optional[object]] = {}


def _get_spell(lang: str):
    """Get or create a SpellChecker for `lang`. None if the language is unsupported."""
    if lang in _spell_cache:
        return _spell_cache[lang]
    try:
        from spellchecker import SpellChecker
        sc = SpellChecker(language=lang)
    except Exception as e:
        log.debug("SpellChecker unavailable for %r: %s", lang, e)
        sc = None
    _spell_cache[lang] = sc
    return sc


# --- Phonotactic red flags ---------------------------------------------------

# Universal: no natural word repeats the same letter three times in a row.
_TRIPLE = re.compile(r"(.)\1\1")

# Vowel sets per language (used for the "all-consonant word" check).
_VOWELS: dict[str, str] = {
    "en": "aeiouy",
    "it": "aeiou",
    "es": "aeiou",
    "fr": "aeiouy",
    "de": "aeiouyäöü",
}

# Impossible consonant runs. Romance languages have simple phonotactics;
# German legitimately allows long clusters (e.g. "Angstschweiss") so it has
# no cluster rule — it relies on the universal flags only.
_IMPOSSIBLE_CLUSTERS: dict[str, re.Pattern] = {
    "it": re.compile(r"[bcdfghjklmnpqrstvwxyz]{4,}|scch"),
    "es": re.compile(r"[bcdfghjklmnpqrstvwxyz]{4,}"),
    "fr": re.compile(r"[bcdfghjklmnpqrstvwxyz]{5,}"),
    "en": re.compile(r"[bcdfghjklmnpqrstvwxyz]{5,}"),
}


def _looks_phonotactically_impossible(word: str, lang: str) -> bool:
    """True if the word has a pattern no real word in `lang` could have."""
    if _TRIPLE.search(word):
        return True
    # A long word with no vowel at all is impossible in these languages
    vowels = _VOWELS.get(lang, "aeiou")
    if len(word) >= 5 and not any(c in vowels for c in word):
        return True
    pattern = _IMPOSSIBLE_CLUSTERS.get(lang)
    if pattern and pattern.search(word):
        return True
    return False


def has_hallucinated_word(
    span: str,
    target_lang: str = "it",
    trusted: Optional[Iterable[str]] = None,
    min_len: int = 6,
) -> bool:
    """Return True if `span` likely contains a hallucinated (non-)word.

    Args:
        span:        the candidate word (single word; multi-word → not checked)
        target_lang: language the word should belong to
        trusted:     words known to be real (e.g. dictionary lookup lemmas) —
                     if `span` is among them, it is never flagged
        min_len:     words shorter than this are never flagged (too noisy)
    """
    if not span or " " in span.strip():
        return False
    word = span.strip().lower()
    if len(word) < min_len:
        return False

    # Signal 1: trusted dictionary lemma → definitely real
    if trusted and word in {t.strip().lower() for t in trusted}:
        return False

    spell = _get_spell(target_lang)

    # Signal 2: spell-checker knows the word → real
    if spell is not None and not spell.unknown([word]):
        return False

    # Signal 3: unknown word — confirm with phonotactics before flagging.
    # (If no spell-checker exists, phonotactics is the only available signal.)
    if _looks_phonotactically_impossible(word, target_lang):
        log.info("Hallucination flagged: %r (%s)", word, target_lang)
        return True

    return False
