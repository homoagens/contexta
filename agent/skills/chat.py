"""ChatSkill — contextual follow-up Q&A on a translation result."""
from __future__ import annotations

import logging
from ..schemas import ChatInput, ChatOutput
from ..tools.client import BackendClient
from ..prompts import build_chat_context_messages

log = logging.getLogger("agent_contexta.skills.chat")


class ChatSkill:
    async def run(self, inp: ChatInput, client: BackendClient) -> ChatOutput:
        messages = build_chat_context_messages(inp.translation_result, inp.question, inp.constrained)
        text = await client.llm(
            messages,
            temperature=0.45,
            top_p=0.9,
            max_tokens=700,
            json_mode=False,
        )
        log.info("Chat answer (%d chars) for %r", len(text), inp.question[:60])
        return ChatOutput(answer=text.strip())
