/**
 * ReaderFoliate — EPUB reader built on the vendored foliate-js engine.
 *
 * This is a parallel implementation to Reader.tsx (epub.js). It is selected
 * via Settings → readerEngine, so the classic reader stays the untouched
 * default. foliate-js gives accurate progress (fraction) and clean CFIs out
 * of the box — no locations.generate(), no relocated/locationChanged quirks.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import '../../foliate/view.js'   // registers the <foliate-view> custom element
import type { Book, Settings, TranslationResult } from '../../types'
import { getBookFile, getBook, updateLastCfi } from '../../store/db'
import { savePosition } from '../../api/books'
import { translateStream, batchTranslate, fetchHardWords } from '../../api/translate'
import TranslationPanel from '../TranslationPanel/TranslationPanel'
import BookChatSheet from './BookChatSheet'

interface Props {
  book: Book
  settings: Settings
  onSettingsChange: (s: Settings) => void
  onClose: () => void
}

interface TocEntry { label: string; href: string; subitems?: TocEntry[] }

// Structural type for the <foliate-view> custom element
interface FoliateView extends HTMLElement {
  open(file: File): Promise<void>
  init(opts: { lastLocation?: string | null }): Promise<void>
  prev(): Promise<void>
  next(): Promise<void>
  goTo(target: string): Promise<unknown>
  deselect(): void
  book: { toc?: TocEntry[] }
  renderer?: {
    setStyles?: (css: string) => void
    setAttribute(name: string, value: string): void
  }
}

interface Selection { text: string; sentence: string }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function flattenToc(toc: TocEntry[] | undefined, depth = 0): { label: string; href: string; depth: number }[] {
  if (!toc) return []
  const out: { label: string; href: string; depth: number }[] = []
  for (const e of toc) {
    if (e.href) out.push({ label: e.label || '—', href: e.href, depth })
    if (e.subitems) out.push(...flattenToc(e.subitems, depth + 1))
  }
  return out
}

function foliateCss(s: Settings): string {
  const bg = s.theme === 'dark' ? '#1a1a1a' : s.theme === 'sepia' ? '#f4ecd8' : '#ffffff'
  const fg = s.theme === 'dark' ? '#e0e0e0' : s.theme === 'sepia' ? '#5b4636' : '#1a1a1a'
  const link = s.theme === 'dark' ? '#7fb3ff' : '#2b6cb0'
  return `
    html, body { background: ${bg} !important; color: ${fg} !important; }
    body {
      font-size: ${s.fontSize}px !important;
      line-height: ${s.lineHeight} !important;
      font-family: ${s.fontFamily}, Georgia, serif !important;
      padding: 0 8px !important;
    }
    p, li, blockquote, dd { line-height: ${s.lineHeight} !important; }
    a { color: ${link} !important; }
  `
}

/** Extract the sentence containing the current selection, for translation context. */
function selectionContext(sel: globalThis.Selection): Selection | null {
  const text = sel.toString().trim()
  if (!text) return null
  let node: Node | null = sel.anchorNode
  while (node && node.nodeType === Node.TEXT_NODE) node = node.parentNode
  let block: Node | null = node
  while (block && block.nodeName && !/^(P|LI|DIV|BLOCKQUOTE|TD|H[1-6])$/.test(block.nodeName)) {
    block = block.parentNode
  }
  const blockText = (block?.textContent || text).replace(/\s+/g, ' ').trim()
  // Find the sentence that contains the selected text
  const sentences = blockText.split(/(?<=[.!?])\s+/)
  const sentence = sentences.find(s => s.includes(text)) || blockText
  return { text, sentence }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ReaderFoliate({ book, settings, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<FoliateView | null>(null)
  const docRef = useRef<Document | null>(null)        // latest loaded section doc
  const readingStateRef = useRef<{ cfi: string; progress: number }>({ cfi: '', progress: 0 })
  const liveSelectionRef = useRef<Selection | null>(null)
  const positionTimerRef = useRef<number>(0)
  const batchTimerRef = useRef<number>(0)
  const batchAbortRef = useRef<AbortController | null>(null)
  const hardWordsRef = useRef<Set<string>>(new Set())
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [toc, setToc] = useState<{ label: string; href: string; depth: number }[]>([])
  const [showToc, setShowToc] = useState(false)
  const [showBookChat, setShowBookChat] = useState(false)

  const [selection, setSelection] = useState<Selection | null>(null)
  const [showPanel, setShowPanel] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [translationResult, setTranslationResult] = useState<TranslationResult | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const canTranslate = !!settings.apiUrl

  // ── Anticipatory cache warming ──────────────────────────────────────────────
  const warmPageCache = useCallback(() => {
    const doc = docRef.current
    if (!doc?.body) return
    const text = doc.body.innerText || ''
    const seen = new Set<string>()
    const words: string[] = []
    for (const m of text.matchAll(/\p{L}{5,}/gu)) {
      const w = m[0].toLowerCase()
      if (seen.has(w)) continue
      seen.add(w)
      words.push(w)
      if (words.length >= 60) break
    }
    if (words.length === 0) return
    const hard = hardWordsRef.current
    if (hard.size > 0) words.sort((a, b) => (hard.has(b) ? 1 : 0) - (hard.has(a) ? 1 : 0))
    batchAbortRef.current?.abort()
    const ctrl = new AbortController()
    batchAbortRef.current = ctrl
    const s = settingsRef.current
    batchTranslate(words, s.sourceLang, s.targetLang, ctrl.signal).catch(() => {})
  }, [])

  // ── Main lifecycle ──────────────────────────────────────────────────────────
  useEffect(() => {
    let destroyed = false

    function onRelocate(e: Event) {
      const detail = (e as CustomEvent).detail || {}
      const cfi: string = detail.cfi || ''
      const pct = typeof detail.fraction === 'number'
        ? Math.round(detail.fraction * 100)
        : readingStateRef.current.progress
      if (cfi) {
        readingStateRef.current = { cfi, progress: pct }
        updateLastCfi(book.id, cfi)
        if (book.source === 'server') {
          clearTimeout(positionTimerRef.current)
          positionTimerRef.current = window.setTimeout(() => {
            savePosition(book.id, cfi, pct).catch(() => {})
          }, 1000)
        }
      }
      setProgress(pct)
      clearTimeout(batchTimerRef.current)
      batchTimerRef.current = window.setTimeout(warmPageCache, 1500)
    }

    function onLoad(e: Event) {
      const detail = (e as CustomEvent).detail || {}
      const doc: Document | undefined = detail.doc
      if (!doc) return
      docRef.current = doc
      let selTimer: ReturnType<typeof setTimeout>
      doc.addEventListener('selectionchange', () => {
        clearTimeout(selTimer)
        selTimer = setTimeout(() => {
          if (destroyed) return
          const sel = doc.defaultView?.getSelection()
          if (!sel || sel.isCollapsed) { liveSelectionRef.current = null; return }
          liveSelectionRef.current = selectionContext(sel)
        }, 300)
      })
    }

    async function init() {
      const buf = await getBookFile(book.id)
      if (!buf) { setError('File del libro non trovato in locale'); setLoading(false); return }
      if (destroyed) return
      const file = new File([buf.slice(0)], 'book.epub', { type: 'application/epub+zip' })
      const view = document.createElement('foliate-view') as FoliateView
      view.style.cssText = 'width:100%;height:100%;display:block'
      viewRef.current = view
      containerRef.current?.append(view)

      view.addEventListener('relocate', onRelocate)
      view.addEventListener('load', onLoad)

      await view.open(file)
      if (destroyed) return
      view.renderer?.setAttribute('flow', 'paginated')
      view.renderer?.setStyles?.(foliateCss(settingsRef.current))
      setToc(flattenToc(view.book.toc))

      const fresh = await getBook(book.id)
      await view.init({ lastLocation: fresh?.lastCfi ?? null })
      if (destroyed) return
      setLoading(false)
    }

    init().catch(err => {
      if (!destroyed) { setError(String(err)); setLoading(false) }
    })

    return () => {
      destroyed = true
      abortRef.current?.abort()
      batchAbortRef.current?.abort()
      clearTimeout(positionTimerRef.current)
      clearTimeout(batchTimerRef.current)
      // final position save
      const { cfi, progress: pct } = readingStateRef.current
      if (cfi && book.source === 'server') {
        savePosition(book.id, cfi, pct).catch(() => {})
      }
      viewRef.current?.remove()
      viewRef.current = null
      docRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id])

  // Re-apply theme/typography when settings change
  useEffect(() => {
    viewRef.current?.renderer?.setStyles?.(foliateCss(settings))
  }, [settings])

  // Load the user's looked-up words for predictive glossing priority
  useEffect(() => {
    fetchHardWords(settingsRef.current.sourceLang)
      .then(w => { hardWordsRef.current = new Set(w) })
      .catch(() => {})
  }, [book.id])

  // Save position when the app goes to background (iOS-safe)
  useEffect(() => {
    const handler = () => {
      if (document.hidden && book.source === 'server' && readingStateRef.current.cfi) {
        const { cfi, progress: pct } = readingStateRef.current
        savePosition(book.id, cfi, pct).catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [book.id, book.source])

  // ── Actions ─────────────────────────────────────────────────────────────────
  async function handleClose() {
    clearTimeout(positionTimerRef.current)
    const { cfi, progress: pct } = readingStateRef.current
    if (cfi) {
      await updateLastCfi(book.id, cfi)
      if (book.source === 'server') {
        try { await savePosition(book.id, cfi, pct) } catch { /* best effort */ }
      }
    }
    onClose()
  }

  async function handleTranslate() {
    const sel = liveSelectionRef.current
    if (!sel || !canTranslate) return
    setSelection(sel)
    setShowPanel(true)
    setTranslating(true)
    setTranslationResult(null)
    setStreamingText('')
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const s = settingsRef.current
    try {
      for await (const ev of translateStream(
        {
          selected_span: sel.text,
          target_sentence: sel.sentence,
          context_before: '',
          context_after: '',
          source_lang: s.sourceLang,
          target_lang: s.targetLang,
          context_mode: s.contextMode,
        },
        s.apiUrl, s.apiKey, ctrl.signal,
      )) {
        if (ev.type === 'token') setStreamingText(prev => prev + ev.text)
        else if (ev.type === 'result') setTranslationResult(ev.data)
        else if (ev.type === 'error') throw new Error(ev.message)
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setTranslationResult({
          selected_span: sel.text, best_result: '', alternatives: [],
          span_role: '', span_sense: '', span_confidence: null,
          improved_sentence: '', notes: 'Error: ' + String(err),
        })
      }
    } finally {
      setTranslating(false)
      setStreamingText('')
    }
  }

  function closePanel() {
    abortRef.current?.abort()
    setShowPanel(false)
    setSelection(null)
    setTranslationResult(null)
    setStreamingText('')
    viewRef.current?.deselect()
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="reader-page">
      <div className="navbar">
        <button className="navbar-icon-btn" onClick={handleClose} title="Torna alla libreria">
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="navbar-title">{book.title}</span>

        <button
          className={`navbar-icon-btn ${showToc ? 'active-icon' : ''}`}
          onClick={() => { setShowBookChat(false); setShowToc(v => !v) }}
          title="Capitoli"
        >
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="15" y2="18" />
          </svg>
        </button>

        <button
          className="navbar-icon-btn"
          onClick={handleTranslate}
          disabled={!canTranslate}
          title="Traduci la selezione"
          style={{ fontWeight: 700, fontSize: 13, opacity: canTranslate ? 1 : 0.35 }}
        >T→</button>

        {book.source === 'server' && (
          <button
            className={`navbar-icon-btn ${showBookChat ? 'active-icon' : ''}`}
            onClick={() => { setShowToc(false); setShowBookChat(v => !v) }}
            title="Chiedi al libro"
          >
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </button>
        )}

        <button className="navbar-icon-btn" onClick={() => viewRef.current?.prev()} title="Precedente">
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <button className="navbar-icon-btn" onClick={() => viewRef.current?.next()} title="Successiva">
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      <div className="epub-container" style={{ position: 'relative' }}>
        <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

        {loading && (
          <div className="spinner-wrap" style={{ position: 'absolute', inset: 0, zIndex: 10 }}>
            <div className="spinner" />
          </div>
        )}
        {error && (
          <div className="empty-state">
            <h3>Errore nel caricamento</h3>
            <p>{error}</p>
          </div>
        )}

        {/* Edge tap zones for page navigation */}
        {!loading && !error && (
          <>
            <div
              style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 44, zIndex: 5 }}
              onClick={() => viewRef.current?.prev()}
            />
            <div
              style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 44, zIndex: 5 }}
              onClick={() => viewRef.current?.next()}
            />
          </>
        )}
      </div>

      {!loading && (
        <div className="reader-progress">{progress}%</div>
      )}

      {showPanel && (
        <TranslationPanel
          selectedText={selection?.text || ''}
          result={translationResult}
          loading={translating}
          streamingText={streamingText}
          apiUrl={settings.apiUrl}
          apiKey={settings.apiKey}
          onClose={closePanel}
        />
      )}

      {showToc && (
        <div className="sheet-overlay" onClick={() => setShowToc(false)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="sheet-header">
              <span className="sheet-title">Capitoli</span>
              <button className="navbar-icon-btn" onClick={() => setShowToc(false)}>
                <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="sheet-body">
              {toc.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Nessun indice disponibile.</p>}
              {toc.map((item, i) => (
                <button
                  key={i}
                  onClick={() => { viewRef.current?.goTo(item.href); setShowToc(false) }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '8px 0', paddingLeft: 8 + item.depth * 16,
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--text)', fontSize: 14,
                    borderBottom: '1px solid var(--border)',
                  }}
                >{item.label}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showBookChat && book.source === 'server' && (
        <BookChatSheet
          bookId={book.id}
          progress={progress}
          targetLang={settings.targetLang}
          onClose={() => setShowBookChat(false)}
        />
      )}
    </div>
  )
}
