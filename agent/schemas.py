"""Domain dataclasses for the agent layer.

These are pure Python dataclasses — no Pydantic dependency required
for the standalone orchestrator script.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


# ---------------------------------------------------------------------------
# Translation
# ---------------------------------------------------------------------------

@dataclass
class TranslateInput:
    """Input for the translate / synonym skill."""
    selected_span: str
    target_sentence: str = ""
    context_before: str = ""
    context_after: str = ""
    source_lang: str = "en"
    target_lang: str = "it"
    context_mode: str = "fast"
    model: str = ""          # per-request model override (e.g. "claude-sonnet-4-6")
    temperature: float = 0.1
    max_tokens: int = 2048

    @property
    def is_same_language(self) -> bool:
        return self.source_lang == self.target_lang


@dataclass
class TranslateOutput:
    """Output of the translate / synonym skill."""
    selected_span: str
    target_sentence_original: str
    target_sentence_normalized: str
    best_result: str
    alternatives: list[str] = field(default_factory=list)
    span_role: str = "UNKNOWN"
    span_sense: str = ""
    span_confidence: Optional[float] = None
    improved_sentence: str = ""
    notes: str = ""
    translated_by: str = ""
    source_lang: str = "en"
    target_lang: str = "it"
    mode: str = "translate"       # "translate" | "synonym"

    def to_dict(self) -> dict:
        """Serialize to a plain dict for JSON responses."""
        return {
            "selected_span": self.selected_span,
            "best_result": self.best_result,
            "alternatives": self.alternatives,
            "span_role": self.span_role,
            "span_sense": self.span_sense,
            "span_confidence": self.span_confidence,
            "improved_sentence": self.improved_sentence,
            "notes": self.notes,
            "translated_by": self.translated_by,
            "source_lang": self.source_lang,
            "target_lang": self.target_lang,
            "mode": self.mode,
        }


# ---------------------------------------------------------------------------
# Chat context
# ---------------------------------------------------------------------------

@dataclass
class ChatInput:
    """Input for contextual follow-up chat on a translation result."""
    translation_result: dict   # the full TranslateOutput dict
    question: str              # user's question
    constrained: bool = True   # True = task tied to the word; False = free chat


@dataclass
class ChatOutput:
    answer: str


# ---------------------------------------------------------------------------
# Lookup (tool result from backend /tools/lookup)
# ---------------------------------------------------------------------------

@dataclass
class LookupResult:
    """Structured result from the lookup tool."""
    type: str          # "idiom" | "wordnet" | "none"
    preferred: bool = False
    target_lemmas: list[str] = field(default_factory=list)
    definitions: list[str] = field(default_factory=list)
    examples: list[str] = field(default_factory=list)

    def as_hints(self) -> Optional[dict]:
        """Convert to the hints dict format expected by prompts.py."""
        if self.type == "none":
            return None
        return {
            "preferred": self.preferred,
            "target_lemmas": self.target_lemmas,
            "definitions": self.definitions,
            "examples": self.examples,
        }
