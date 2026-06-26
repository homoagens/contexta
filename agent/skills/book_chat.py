"""BookChatSkill — contextual Q&A about a whole book, grounded in its KB.

Two modes:
  - companion : a literary assistant answering questions about the book
  - persona   : the agent answers in the first-person voice of the book itself

The book KB (built by AnalyzeBookSkill) is the only knowledge source, and
chapter context is clipped to the reader's current position to avoid spoilers.
"""
from __future__ import annotations

import logging
from typing import Optional

from ..tools.client import BackendClient
from ..prompts import build_book_chat_messages

log = logging.getLogger("agent.skills.book_chat")


class BookChatSkill:
    async def run(
        self,
        kb: dict,
        question: str,
        persona: bool,
        up_to_chapter: Optional[int],
        target_lang: str,
        client: BackendClient,
    ) -> dict:
        messages = build_book_chat_messages(
            kb, question, persona=persona,
            up_to_chapter=up_to_chapter, target_lang=target_lang,
        )
        text = await client.llm(
            messages,
            temperature=0.6 if persona else 0.4,
            top_p=0.9,
            max_tokens=700,
            json_mode=False,
        )
        log.info("Book chat (persona=%s) answered %r", persona, question[:60])
        return {"answer": text.strip()}
