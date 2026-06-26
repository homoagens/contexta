"""AnalyzeBookSkill — build a per-book knowledge base from its chapters.

Runs as a background job after a book is uploaded. For each chapter it makes
one compact LLM call (2-sentence summary + character names), then one final
consolidation call produces the whole-book summary, themes and character list.

Bounded cost: at most MAX_CHAPTERS chapters are analyzed; longer books are
sampled evenly so the job stays predictable.
"""
from __future__ import annotations

import logging

from ..tools.client import BackendClient
from ..prompts import (
    build_chapter_summary_messages,
    build_kb_consolidation_messages,
)
from .._json import parse_json_object

log = logging.getLogger("agent.skills.analyze")

# Upper bound on per-chapter LLM calls per book
MAX_CHAPTERS = 30


def _sample(chapters: list[dict], limit: int) -> list[tuple[int, dict]]:
    """Return (original_index, chapter) pairs, evenly sampled if too many."""
    n = len(chapters)
    if n <= limit:
        return list(enumerate(chapters))
    step = n / limit
    return [(int(i * step), chapters[int(i * step)]) for i in range(limit)]


class AnalyzeBookSkill:
    async def run(self, chapters: list[dict], client: BackendClient) -> dict:
        """Analyze chapters → KB dict. Never raises; returns best-effort KB."""
        if not chapters:
            return {"summary": "", "themes": [], "characters": [], "chapters": []}

        chapter_entries: list[dict] = []
        summaries: list[str] = []

        for orig_idx, ch in _sample(chapters, MAX_CHAPTERS):
            try:
                text = await client.llm(
                    build_chapter_summary_messages(ch.get("title", ""), ch.get("text", "")),
                    temperature=0.2, max_tokens=400, json_mode=True,
                )
                obj = parse_json_object(text)
                summary = str(obj.get("summary") or "").strip()
            except Exception as e:
                log.warning("Chapter %d summary failed: %s", orig_idx, e)
                summary = ""
            if summary:
                summaries.append(summary)
            chapter_entries.append({
                "index": orig_idx,
                "title": ch.get("title", ""),
                "summary": summary,
            })

        # Consolidation pass
        book_summary, themes, characters = "", [], []
        if summaries:
            try:
                text = await client.llm(
                    build_kb_consolidation_messages(summaries),
                    temperature=0.3, max_tokens=900, json_mode=True,
                )
                obj = parse_json_object(text)
                book_summary = str(obj.get("summary") or "").strip()
                themes = [str(t).strip() for t in (obj.get("themes") or []) if str(t).strip()]
                for c in (obj.get("characters") or []):
                    if isinstance(c, dict) and c.get("name"):
                        characters.append({
                            "name": str(c["name"]).strip(),
                            "description": str(c.get("description") or "").strip(),
                        })
            except Exception as e:
                log.warning("KB consolidation failed: %s", e)

        log.info("KB built: %d chapters, %d characters, %d themes",
                 len(chapter_entries), len(characters), len(themes))
        return {
            "summary": book_summary,
            "themes": themes,
            "characters": characters,
            "chapters": chapter_entries,
        }
