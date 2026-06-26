// ─── Domain types ────────────────────────────────────────────────────────────

export interface Book {
  id: string           // uuid (local) or sha256 (server)
  title: string
  author: string
  addedAt: number      // Date.now()
  lastCfi?: string     // last reading position
  cover?: string       // base64 data-url or undefined
  source?: 'local' | 'server'
}

export interface ServerBook {
  id: string
  filename: string
  title: string
  author: string
  cover: string | null
  size_bytes: number
  uploaded_at: number
  last_cfi: string | null
  last_progress: number | null
}

export interface Highlight {
  id: string
  bookId: string
  cfi: string          // epub.js CFI for the selection
  selectedText: string
  translation: TranslationResult
  note?: string
  createdAt: number
}

export interface SrsState {
  due: number        // timestamp (ms) when the card is next due
  interval: number   // current interval in days
  ease: number       // ease factor (1.3–3.0)
  reps: number       // consecutive successful reviews
  lapses: number     // number of times the card was failed
}

export interface FavoriteWord {
  id: string
  word: string
  translation: string
  alternatives: string[]
  sense: string
  evidence: string
  sentence_it: string
  createdAt: number
  srs?: SrsState     // spaced-repetition scheduling state
}

export type Theme = 'light' | 'sepia' | 'dark'
export type ContextMode = 'fast' | 'medium' | 'slow'

export const SUPPORTED_LANGS: Record<string, string> = {
  en: 'English',
  it: 'Italiano',
  es: 'Español',
  de: 'Deutsch',
  fr: 'Français',
  pt: 'Português',
  ru: 'Русский',
  ja: '日本語',
  zh: '中文',
}

/** Characters of context to send per context mode */
export const CONTEXT_CHARS: Record<ContextMode, number> = {
  fast:   200,
  medium: 600,
  slow:   1500,
}

/** Max tokens budget per context mode */
export const MAX_TOKENS: Record<ContextMode, number> = {
  fast:   2048,
  medium: 3072,
  slow:   4096,
}

export interface AgentModel {
  value: string
  label: string
  provider: 'local' | 'anthropic'
}

export const AGENT_MODELS: AgentModel[] = [
  { value: 'local', label: 'Local (gemma3-4b)', provider: 'local' },
]

export type FontFamily =
  | 'Avenir Next'
  | 'Georgia'
  | 'Palatino'
  | 'Times'
  | 'Charter'
  | 'System'
  | 'Helvetica'

/** Map from FontFamily display name to the CSS font-family stack */
export const FONT_CSS: Record<FontFamily, string> = {
  'Avenir Next': '"Avenir Next", "Avenir", "Helvetica Neue", sans-serif',
  'Georgia':     'Georgia, serif',
  'Palatino':    '"Palatino Linotype", Palatino, serif',
  'Times':       '"Times New Roman", Times, serif',
  'Charter':     'Charter, "Bitstream Charter", Georgia, serif',
  'System':      'system-ui, -apple-system, sans-serif',
  'Helvetica':   '"Helvetica Neue", Helvetica, Arial, sans-serif',
}

export interface Settings {
  apiUrl: string
  apiKey: string
  theme: Theme
  fontSize: number      // 14-28
  lineHeight: number    // 1.2-2.0
  fontFamily: FontFamily
  sourceLang: string    // ISO 639-1
  targetLang: string    // ISO 639-1
  contextMode: ContextMode
  model: string         // value from AGENT_MODELS
  readerEngine?: 'classic' | 'foliate'   // EPUB rendering engine
}

// ─── API types (mirrors backend schemas.py) ───────────────────────────────────

export interface TranslateRequest {
  // Generic fields (preferred)
  selected_span: string
  target_sentence: string
  context_before: string
  context_after: string
  source_lang: string
  target_lang: string
  context_mode: ContextMode
  model?: string
  temperature?: number
  max_tokens?: number
}

export interface TranslationResult {
  // Generic fields (new)
  selected_span: string
  best_result: string
  alternatives: string[]
  span_role: string
  span_sense: string
  span_confidence: number | null
  improved_sentence: string
  notes: string
  translated_by?: string
  source_lang?: string
  target_lang?: string
  mode?: string   // "translate" | "synonym"
}
