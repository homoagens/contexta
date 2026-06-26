import type { TranslateRequest, TranslationResult } from '../types'
import { getStoredToken } from './auth'

/**
 * Resolve the endpoint URL.
 *
 * Dev mode (Vite, import.meta.env.DEV = true):
 *   usa il proxy /api/* → agent :8001 (configurato in vite.config.ts)
 * Production (build + FastAPI, import.meta.env.DEV = false, sostituito da Vite):
 *   usa path relativo /health /translate — stessa origine di FastAPI
 */
function resolveUrl(_apiUrl: string, path: string): string {
  if (import.meta.env.DEV) {
    return `/api${path}`
  }
  return path
}

export async function translate(
  req: TranslateRequest,
  apiUrl: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<TranslationResult> {
  const url = resolveUrl(apiUrl, '/translate')
  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`API ${res.status}: ${text || res.statusText}`)
  }
  return res.json() as Promise<TranslationResult>
}

/**
 * Pre-translate a batch of words to warm the server cache.
 * Fire-and-forget: failures are swallowed — this only improves latency.
 */
export async function batchTranslate(
  words: string[],
  sourceLang: string,
  targetLang: string,
  signal?: AbortSignal,
): Promise<void> {
  if (words.length === 0) return
  const token = getStoredToken()
  if (!token) return
  try {
    await fetch(resolveUrl('', '/translate_batch'), {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      // sentence omitted → backend warms context-free cache entries
      body: JSON.stringify({
        items: words.map(w => ({ span: w, sentence: '' })),
        source_lang: sourceLang,
        target_lang: targetLang,
      }),
    })
  } catch { /* best-effort */ }
}

// ─── Streaming translation ───────────────────────────────────────────────────

export type StreamEvent =
  | { type: 'token';  text: string }
  | { type: 'result'; data: TranslationResult }
  | { type: 'error';  message: string }

/**
 * Stream a translation request. Yields StreamEvent objects:
 *   - "token"  — incremental LLM output (raw JSON fragment building up)
 *   - "result" — final parsed TranslationResult (always last on success)
 *   - "error"  — unrecoverable server-side failure
 *
 * Cache hits yield a single "result" event with no preceding "token" events.
 * Aborts cleanly when signal fires.
 */
export async function* translateStream(
  req: TranslateRequest,
  apiUrl: string,
  apiKey: string,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const url = resolveUrl(apiUrl, '/translate_stream')
  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`API ${res.status}: ${text || res.statusText}`)
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // SSE messages are separated by blank lines (\n\n)
      const parts = buffer.split('\n\n')
      buffer = parts.pop() ?? ''
      for (const part of parts) {
        for (const line of part.split('\n')) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (!raw) continue
          try {
            yield JSON.parse(raw) as StreamEvent
          } catch { /* malformed chunk — ignore */ }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export async function chatContext(
  translationResult: import('../types').TranslationResult,
  question: string,
  apiUrl: string,
  apiKey: string,
  signal?: AbortSignal,
  constrained = true,
): Promise<string> {
  const url = resolveUrl(apiUrl, '/chat_context')
  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ translation_result: translationResult, question, constrained }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`API ${res.status}: ${text || res.statusText}`)
  }
  const data = await res.json()
  return String(data.answer ?? '')
}

// ─── Vocabulary profile ─────────────────────────────────────────────────────

/** Words the user has looked up before — used to prioritise predictive glossing. */
export async function fetchHardWords(sourceLang: string): Promise<string[]> {
  const token = getStoredToken()
  if (!token) return []
  try {
    const r = await fetch(resolveUrl('', `/vocab/hard?source_lang=${sourceLang}`), {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!r.ok) return []
    const d = await r.json()
    return Array.isArray(d.words) ? d.words : []
  } catch {
    return []
  }
}

// ─── Book knowledge base + contextual chat ──────────────────────────────────

export interface BookKb {
  status: string   // "pending" | "ready" | "failed"
  kb: {
    summary: string
    themes: string[]
    characters: { name: string; description: string }[]
    chapters: { index: number; title: string; summary: string }[]
  } | null
}

export async function fetchBookKb(bookId: string): Promise<BookKb> {
  const token = getStoredToken()
  const r = await fetch(resolveUrl('', `/books/${bookId}/kb`), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!r.ok) throw new Error(`kb ${r.status}`)
  return r.json() as Promise<BookKb>
}

export async function bookChat(
  bookId: string,
  question: string,
  persona: boolean,
  upToChapter: number | null,
  targetLang: string,
  signal?: AbortSignal,
): Promise<string> {
  const token = getStoredToken()
  const r = await fetch(resolveUrl('', '/book_chat'), {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      book_id: bookId, question, persona,
      up_to_chapter: upToChapter, target_lang: targetLang,
    }),
  })
  if (!r.ok) {
    if (r.status === 409) throw new Error('kb_not_ready')
    throw new Error(`chat ${r.status}`)
  }
  const d = await r.json()
  return String(d.answer ?? '')
}

export async function checkHealth(apiUrl: string, apiKey: string): Promise<{
  ok: boolean;
  llm_model?: string;
  mode?: string;
  backend?: { ok: boolean; llm_model?: string };
  backend_error?: string;
}> {
  const url = resolveUrl(apiUrl, '/health')
  const res = await fetch(url, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  return res.json()
}
