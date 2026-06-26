"""Contexta Agent — Python orchestrator for contextual translation.

Architecture (Pattern B — direct skill dispatch, no ReAct loop):

    Browser → FastAPI (server.py) → Agent (agent.py) → Skill → LLM client
                                                       ↓
                                                    Validator

Components:
  server.py         HTTP layer — auth, books, translation endpoints
  agent.py          Router — dispatches requests to the right skill
  skills/           Domain logic — prompts, retry, parse, validate
  tools/client.py   LLM abstraction — local backend, Anthropic, OpenAI
  prompts.py        All system/user prompt templates
  validator.py      Hallucination detection (spell-check + phonotactics)
  schemas.py        Typed input/output dataclasses
  db.py             Shared SQLite connection (WAL mode)
  auth.py           User/session management (PBKDF2 + tokens)
  books.py          EPUB storage + reading position sync
"""
