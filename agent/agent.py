"""AgentRunner — dispatches tasks to the right skill.

This is the orchestrator core. It holds the skill registry and the
shared backend client. Skills handle all the domain logic; the agent
just routes and wires them together.

Usage (programmatic):
    async with Agent(backend_url, api_key) as agent:
        result = await agent.run("translate", {"selected_span": "manifest time", ...})
"""
from __future__ import annotations

import logging
from typing import Any

from .tools.client import BackendClient
from .skills.translate import TranslateSkill
from .skills.chat import ChatSkill
from .skills.batch import BatchTranslateSkill
from .skills.analyze import AnalyzeBookSkill
from .skills.book_chat import BookChatSkill
from .schemas import TranslateInput, ChatInput

log = logging.getLogger("agent")

_TRANSLATE_FIELDS = {f for f in TranslateInput.__dataclass_fields__}


class Agent:
    """Lightweight orchestrator.

    - Backend provides dumb tools (/llm, /tools/lookup)
    - Skills contain all task-specific logic (prompts, retry, validation)
    - Agent routes input to the right skill and returns a plain dict
    """

    def __init__(self, backend_url: str, api_key: str) -> None:
        self.client = BackendClient(backend_url, api_key)
        self._skills: dict[str, Any] = {
            "translate": TranslateSkill(),
            "chat": ChatSkill(),
            "batch_translate": BatchTranslateSkill(),
            "analyze": AnalyzeBookSkill(),
            "book_chat": BookChatSkill(),
        }
        log.info("Agent ready — skills: %s", list(self._skills))

    # ------------------------------------------------------------------
    # Context manager support
    # ------------------------------------------------------------------

    async def __aenter__(self) -> "Agent":
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.client.close()

    # ------------------------------------------------------------------
    # Main dispatch
    # ------------------------------------------------------------------

    async def run(self, skill_name: str, input_data: dict) -> dict:
        """Run a named skill and return the result as a plain dict.

        Args:
            skill_name:  one of the registered skill names (e.g. "translate")
            input_data:  raw dict with skill-specific fields

        Returns:
            Plain dict suitable for JSON serialisation.

        Raises:
            ValueError:   unknown skill name
            RuntimeError: skill exhausted all retries
        """
        skill = self._skills.get(skill_name)
        if skill is None:
            available = list(self._skills)
            raise ValueError(
                f"Unknown skill {skill_name!r}. Available: {available}"
            )

        log.info("Running skill %r — input keys: %s", skill_name, list(input_data))

        if skill_name == "translate":
            inp = TranslateInput(
                **{k: v for k, v in input_data.items() if k in _TRANSLATE_FIELDS}
            )
            out = await skill.run(inp, self.client)
            return out.to_dict()

        if skill_name == "chat":
            inp_chat = ChatInput(
                translation_result=input_data.get("translation_result", {}),
                question=input_data.get("question", ""),
                constrained=input_data.get("constrained", True),
            )
            out_chat = await skill.run(inp_chat, self.client)
            return {"answer": out_chat.answer}

        if skill_name == "batch_translate":
            return await skill.run(
                items=input_data.get("items", []),
                source_lang=input_data.get("source_lang", "en"),
                target_lang=input_data.get("target_lang", "it"),
                model=input_data.get("model", ""),
                client=self.client,
            )

        if skill_name == "analyze":
            return await skill.run(
                chapters=input_data.get("chapters", []),
                client=self.client,
            )

        if skill_name == "book_chat":
            return await skill.run(
                kb=input_data.get("kb", {}),
                question=input_data.get("question", ""),
                persona=input_data.get("persona", False),
                up_to_chapter=input_data.get("up_to_chapter"),
                target_lang=input_data.get("target_lang", "it"),
                client=self.client,
            )

        raise ValueError(f"Unhandled skill: {skill_name!r}")

    # ------------------------------------------------------------------
    # Utilities
    # ------------------------------------------------------------------

    async def health(self) -> dict:
        """Check backend connectivity."""
        return await self.client.health()
