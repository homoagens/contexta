import { useEffect, useRef, useState, useCallback } from 'react'
import Epub, { Book as EpubBook, Rendition } from 'epubjs'
import { getBookFile, getBook, updateLastCfi, saveSettings, getFavorites, deleteFavorite } from '../../store/db'
import { translateStream, batchTranslate, fetchHardWords } from '../../api/translate'
import BookChatSheet from './BookChatSheet'
import { savePosition } from '../../api/books'
import TranslationPanel from '../TranslationPanel/TranslationPanel'
import type { Book, Settings, TranslationResult, Theme, FontFamily, FavoriteWord } from '../../types'
import { FONT_CSS, CONTEXT_CHARS, MAX_TOKENS, SUPPORTED_LANGS, AGENT_MODELS } from '../../types'

// ─── Context extraction helpers ───────────────────────────────────────────────

/** Walk up the DOM to find the nearest block-level element's text content. */
function getBlockText(node: Node | null): string {
  let n = node
  while (n) {
    if (n.nodeType === 1) {
      const tag = (n as Element).tagName?.toLowerCase() ?? ''
      if (/^(p|div|li|td|h[1-6]|blockquote|section|article|body)$/.test(tag)) {
        return (n as Element).textContent ?? ''
      }
    }
    n = n.parentNode
  }
  return node?.textContent ?? ''
}

/** Extract the containing sentence and context chars around it. */
function extractContext(
  block: string, text: string, ctxChars: number
): { sentence: string; contextBefore: string; contextAfter: string } {
  const idx = block.indexOf(text)
  if (idx < 0) return { sentence: text, contextBefore: '', contextAfter: '' }

  // Find sentence start: last [.!?] followed by space before the selected text
  let sentStart = 0
  for (let i = idx - 1; i >= 0; i--) {
    if ('.!?'.includes(block[i]) && block[i + 1] === ' ') {
      sentStart = i + 2
      break
    }
  }

  // Find sentence end: first [.!?] after the selected text
  let sentEnd = block.length
  for (let i = idx + text.length; i < block.length; i++) {
    if ('.!?'.includes(block[i])) {
      sentEnd = i + 1
      break
    }
  }

  const sentence = block.slice(sentStart, sentEnd).trim()
  const contextBefore = sentStart > 0
    ? block.slice(Math.max(0, sentStart - ctxChars), sentStart).trim()
    : ''
  const contextAfter = sentEnd < block.length
    ? block.slice(sentEnd, Math.min(block.length, sentEnd + ctxChars)).trim()
    : ''

  return { sentence, contextBefore, contextAfter }
}

interface Props {
  book: Book
  settings: Settings
  onSettingsChange: (s: Settings) => void
  onClose: () => void
}

interface SelectionState {
  text: string
  sentence: string
  contextBefore: string
  contextAfter: string
  x: number
  y: number
  yBottom: number
}

interface TocItem {
  id: string
  href: string
  label: string
  level: number   // 0 = top, 1 = sub-chapter
  subitems?: TocItem[]
}

function flattenToc(items: TocItem[], level = 0): TocItem[] {
  const result: TocItem[] = []
  for (const item of items) {
    result.push({ ...item, level })
    if (item.subitems?.length) result.push(...flattenToc(item.subitems, level + 1))
  }
  return result
}

function themeStyles(s: Settings): Record<string, Record<string, string>> {
  const themes: Record<string, { bg: string; color: string }> = {
    light: { bg: '#ffffff', color: '#1a1a1a' },
    sepia: { bg: '#f8f0e3', color: '#3b2e1e' },
    dark:  { bg: '#121212', color: '#e8e8e8' },
  }
  const { bg, color } = themes[s.theme] ?? themes.light
  const fontStack = FONT_CSS[s.fontFamily] ?? FONT_CSS['Avenir Next']
  return {
    body: {
      'background': bg + ' !important',
      'color': color + ' !important',
      'font-family': fontStack + ' !important',
      'font-size': s.fontSize + 'px !important',
      'line-height': String(s.lineHeight) + ' !important',
    },
    'html': { 'background': bg + ' !important' },
    'p, div, span, li, td, blockquote': {
      'font-family': fontStack + ' !important',
      'font-size': s.fontSize + 'px !important',
      'line-height': String(s.lineHeight) + ' !important',
    },
    '::selection': { 'background': '#4a6cf740 !important' },
  }
}

export default function Reader({ book, settings, onSettingsChange, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // epub renders into this narrower inner div (20px inset per side) so text
  // never touches screen edges — epub.js paginates to the correct narrower width.
  const epubViewRef = useRef<HTMLDivElement>(null)
  const epubRef = useRef<EpubBook | null>(null)
  const renditionRef = useRef<Rendition | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [location, setLocation] = useState<string>('')
  const [progress, setProgress] = useState(0)

  // TOC
  const [toc, setToc] = useState<TocItem[]>([])
  const [showToc, setShowToc] = useState(false)

  // Panels
  const [showReaderSettings, setShowReaderSettings] = useState(false)
  const [showFavorites, setShowFavorites] = useState(false)
  const [showBookChat, setShowBookChat] = useState(false)

  // Selection / translation
  const [selection, setSelection] = useState<SelectionState | null>(null)
  const [translating, setTranslating] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [translationResult, setTranslationResult] = useState<TranslationResult | null>(null)
  const [showPanel, setShowPanel] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const currentCfiRef = useRef<string>('')   // always holds the latest reading position
  const [resumeToast, setResumeToast] = useState(false)
  const lastSwipeRef = useRef(0)
  const swipeTouchRef = useRef({ x: 0, y: 0, t: 0, moved: false })

  const settingsRef = useRef(settings)
  settingsRef.current = settings

  // Tracks showPanel inside closures (e.g. iframe touch handler) where React
  // state is stale.  Updated every render, no extra effect needed.
  const showPanelRef = useRef(false)
  showPanelRef.current = showPanel

  const positionSyncTimerRef = useRef<number>(0)
  // Tracks latest cfi + progress for use in event handlers and cleanup closures
  const readingStateRef = useRef<{ cfi: string; progress: number }>({ cfi: '', progress: 0 })
  // True once book.locations.generate() has completed — used to suppress the
  // inaccurate spine-based % that would otherwise flash before the accurate one.
  const locationsReadyRef = useRef(false)
  // Anticipatory batch-translation: warms the server cache for the current page
  const batchWarmTimerRef = useRef<number>(0)
  const batchAbortRef = useRef<AbortController | null>(null)
  // Words the user has looked up before — prioritised when warming the cache
  const hardWordsRef = useRef<Set<string>>(new Set())

  // Source-of-truth for the current selection: text nodes + offsets.
  // expandSelection() reads AND writes this directly — never relies on the
  // iframe's live selection state (which iOS may clear on any focus change).
  const selectionSourceRef = useRef<{
    startNode: Text; startOffset: number
    endNode:   Text; endOffset:   number
  } | null>(null)

  const applyTheme = useCallback((rendition: Rendition, s: Settings) => {
    try {
      rendition.themes.register('custom', { '*': {}, ...themeStyles(s) })
      rendition.themes.select('custom')
    } catch { /* ignore */ }
  }, [])

  function closeAllPanels() {
    setShowToc(false)
    setShowReaderSettings(false)
    setShowFavorites(false)
    setShowBookChat(false)
  }

  useEffect(() => {
    let destroyed = false

    async function init() {
      const buf = await getBookFile(book.id)
      if (!buf) { setError('Book file not found'); setLoading(false); return }
      if (destroyed) return

      const epubBook = Epub(buf.slice(0))
      epubRef.current = epubBook
      await epubBook.ready
      if (destroyed) { epubBook.destroy(); return }

      // Load TOC
      try {
        const nav = await epubBook.loaded.navigation
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawToc: TocItem[] = (nav as any).toc ?? []
        setToc(flattenToc(rawToc))
      } catch { /* toc optional */ }

      const el = containerRef.current
      const epubView = epubViewRef.current
      if (!el || !epubView) { epubBook.destroy(); return }

      const rendition = epubBook.renderTo(epubView, {
        width: '100%', height: '100%',
        flow: 'paginated', spread: 'none',
      })
      renditionRef.current = rendition
      applyTheme(rendition, settingsRef.current)

      // iOS Safari fix: epub.js 'selected' usa mouseup che non scatta con le
      // maniglie touch. hooks.content.register inietta selectionchange direttamente
      // nel documento di ogni iframe — l'unico punto dove l'evento è visibile su iOS.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(rendition as any).hooks.content.register((contents: any) => {
        const doc: Document = contents.document
        const win: Window   = contents.window ?? doc?.defaultView
        if (!doc || !win) return
        let selTimer: ReturnType<typeof setTimeout>
        doc.addEventListener('selectionchange', () => {
          clearTimeout(selTimer)

          // Synchronous: seed selectionSourceRef immediately so expand buttons
          // work even if the user taps ▶ before the 400ms debounce fires.
          const selNow = win.getSelection()
          if (selNow && !selNow.isCollapsed && selNow.rangeCount > 0) {
            const r = selNow.getRangeAt(0)
            if (r.startContainer.nodeType === Node.TEXT_NODE &&
                r.endContainer.nodeType   === Node.TEXT_NODE) {
              selectionSourceRef.current = {
                startNode: r.startContainer as Text, startOffset: r.startOffset,
                endNode:   r.endContainer   as Text, endOffset:   r.endOffset,
              }
            }
          } else {
            selectionSourceRef.current = null
          }

          selTimer = setTimeout(() => {
            if (destroyed) return
            const sel = win.getSelection()
            if (!sel || sel.isCollapsed) { setSelection(null); return }
            const text = sel.toString().trim()
            if (!text) return
            const block = getBlockText(sel.anchorNode)
            const { sentence, contextBefore, contextAfter } = extractContext(block, text, CONTEXT_CHARS[settingsRef.current.contextMode])
            let x = window.innerWidth / 2, y = window.innerHeight / 2, yBottom = window.innerHeight / 2 + 40
            try {
              const range = sel.getRangeAt(0)
              const rect  = range.getBoundingClientRect()
              const iframe    = el.querySelector('iframe')
              const iframeRect = iframe?.getBoundingClientRect() ?? { left: 0, top: 0 }
              x = iframeRect.left + rect.left + rect.width / 2
              y = iframeRect.top  + rect.top  - 10
              yBottom = iframeRect.top + rect.bottom + 10
            } catch { /* ignore */ }
            setSelection({ text, sentence, contextBefore, contextAfter, x, y, yBottom })
            setTranslationResult(null)
            setShowPanel(false)
          }, 400)
        })

        // Disable pinch-to-zoom inside the epub iframe.
        // epub.js does not inject a viewport meta, so iOS defaults to allowing
        // zoom — which breaks swipe navigation and selection entirely.
        {
          const existingVP = doc.querySelector('meta[name="viewport"]')
          if (existingVP) {
            existingVP.setAttribute('content',
              'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
          } else {
            const vp = doc.createElement('meta')
            vp.name = 'viewport'
            vp.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no'
            doc.head?.appendChild(vp)
          }
        }

        // Swipe detection inside the iframe — primary on iOS when no overlay blocks it,
        // fallback on Android Chrome / desktop touch.
        let touchStartX = 0, touchStartY = 0
        doc.addEventListener('touchstart', (e: TouchEvent) => {
          touchStartX = e.touches[0].clientX
          touchStartY = e.touches[0].clientY
        }, { passive: true })
        doc.addEventListener('touchend', (e: TouchEvent) => {
          if (showPanelRef.current) return   // don't navigate behind open panel
          const dx = e.changedTouches[0].clientX - touchStartX
          const dy = e.changedTouches[0].clientY - touchStartY
          const now = Date.now()
          if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && now - lastSwipeRef.current > 600) {
            const sel = win.getSelection()
            if (!sel || sel.isCollapsed) {
              lastSwipeRef.current = now
              if (dx > 0) renditionRef.current?.prev()
              else renditionRef.current?.next()
            }
          }
        }, { passive: true })
      })

      // Use 'relocated' (not the deprecated 'locationChanged') — it passes the full
      // location object: loc.start.cfi, loc.start.percentage, loc.start.displayed
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rendition.on('relocated', (loc: any) => {
        const cfi: string = loc?.start?.cfi ?? ''
        // Use epub.js percentage if locations have been generated, otherwise
        // estimate from spine index + displayed page within the current chapter.
        let pct: number
        if (loc?.start?.percentage != null && loc.start.percentage > 0) {
          pct = Math.round(loc.start.percentage * 100)
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const spineLen: number = (epubBook.spine as any)?.items?.length ?? 1
          const idx: number = loc?.start?.index ?? 0
          const page: number  = loc?.start?.displayed?.page  ?? 1
          const total: number = loc?.start?.displayed?.total ?? 1
          const chapterFraction = total > 1 ? (page - 1) / total : 0
          pct = Math.round(((idx + chapterFraction) / Math.max(spineLen, 1)) * 100)
        }
        if (cfi) {
          currentCfiRef.current = cfi
          readingStateRef.current = { cfi, progress: pct }
          updateLastCfi(book.id, cfi)
          if (book.source === 'server') {
            clearTimeout(positionSyncTimerRef.current)
            positionSyncTimerRef.current = window.setTimeout(() => {
              savePosition(book.id, cfi, pct).catch(() => {})
            }, 1000)
          }
        }
        setLocation(cfi)
        // Only update the visible % once locations are generated (accurate value).
        // Before that, the display shows '…' to avoid a misleading spine-based flash.
        if (locationsReadyRef.current) setProgress(pct)
        // Anticipatory cache warming for the current page (debounced)
        clearTimeout(batchWarmTimerRef.current)
        batchWarmTimerRef.current = window.setTimeout(warmPageCache, 1500)
      })

      // Read fresh CFI from DB (book prop may be stale from Library state)
      const freshBook = await getBook(book.id)
      if (freshBook?.lastCfi) {
        currentCfiRef.current = freshBook.lastCfi
        setResumeToast(true)
        setTimeout(() => setResumeToast(false), 2500)
      }
      await rendition.display(freshBook?.lastCfi || undefined)
      if (destroyed) return
      setLoading(false)

      // Generate locations so that loc.start.percentage is accurate.
      // On completion: unlock the progress display and save the precise position.
      epubBook.locations.generate(1600).then(() => {
        if (destroyed) return
        locationsReadyRef.current = true
        // Get accurate percentage for the current position
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cur = (renditionRef.current as any)?.currentLocation?.()
        const accuratePct = cur?.start?.percentage != null
          ? Math.round(cur.start.percentage * 100)
          : readingStateRef.current.progress
        const cfi = cur?.start?.cfi ?? readingStateRef.current.cfi
        readingStateRef.current = { cfi: cfi || readingStateRef.current.cfi, progress: accuratePct }
        setProgress(accuratePct)
        // Re-save with the accurate percentage (and possibly a more precise CFI)
        if (book.source === 'server' && readingStateRef.current.cfi) {
          savePosition(book.id, readingStateRef.current.cfi, accuratePct).catch(() => {})
        }
      }).catch(() => {})

      rendition.on('selected', (cfiRange: string, contents: { window: Window }) => {
        void cfiRange
        const win = contents?.window
        if (!win) return
        const sel = win.getSelection()
        if (!sel || sel.isCollapsed) return
        const text = sel.toString().trim()
        if (!text) return

        const block = getBlockText(sel.anchorNode)
        const { sentence, contextBefore, contextAfter } = extractContext(block, text, CONTEXT_CHARS[settingsRef.current.contextMode])

        let x = window.innerWidth / 2, y = window.innerHeight / 2, yBottom = window.innerHeight / 2 + 40
        try {
          const range = sel.getRangeAt(0)
          const rect = range.getBoundingClientRect()
          const iframe = el.querySelector('iframe')
          const iframeRect = iframe?.getBoundingClientRect() ?? { left: 0, top: 0 }
          x = iframeRect.left + rect.left + rect.width / 2
          y = iframeRect.top + rect.top - 10
          yBottom = iframeRect.top + rect.bottom + 10
        } catch { /* ignore */ }

        setSelection({ text, sentence, contextBefore, contextAfter, x, y, yBottom })
        setTranslationResult(null)
        setShowPanel(false)
      })

      rendition.on('click', () => {
        const iframes = el.querySelectorAll('iframe')
        let hasSelection = false
        iframes.forEach(iframe => {
          try {
            const sel = iframe.contentWindow?.getSelection()
            if (sel && !sel.isCollapsed) hasSelection = true
          } catch { /* ignore */ }
        })
        if (!hasSelection) setSelection(null)
      })
    }

    init().catch(err => {
      if (!destroyed) { setError(String(err)); setLoading(false) }
    })

    return () => {
      destroyed = true
      abortRef.current?.abort()
      batchAbortRef.current?.abort()
      clearTimeout(positionSyncTimerRef.current)
      clearTimeout(batchWarmTimerRef.current)
      // Save final position to server immediately on close (no debounce wait)
      if (book.source === 'server' && readingStateRef.current.cfi) {
        const { cfi, progress } = readingStateRef.current
        savePosition(book.id, cfi, progress).catch(() => {})
      }
      renditionRef.current?.destroy()
      epubRef.current?.destroy()
      renditionRef.current = null
      epubRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id])

  useEffect(() => {
    if (renditionRef.current) applyTheme(renditionRef.current, settings)
  }, [settings, applyTheme])

  // Load the user's looked-up words once, to prioritise predictive glossing
  useEffect(() => {
    fetchHardWords(settingsRef.current.sourceLang)
      .then(words => { hardWordsRef.current = new Set(words) })
      .catch(() => {})
  }, [book.id])

  // Outer-container swipe fallback (iOS: touches in iframe margins, outside iframe content)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let sx = 0, sy = 0
    const onStart = (e: TouchEvent) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY }
    const onEnd = (e: TouchEvent) => {
      const dx = e.changedTouches[0].clientX - sx
      const dy = e.changedTouches[0].clientY - sy
      const now = Date.now()
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && now - lastSwipeRef.current > 600) {
        lastSwipeRef.current = now
        if (dx > 0) renditionRef.current?.prev()
        else renditionRef.current?.next()
      }
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchend', onEnd)
    }
  }, [book.id])

  // visibilitychange: save position when app goes to background (iOS kills fetch on close,
  // but visibilitychange fires reliably before the page is destroyed).
  // Also restore layout when returning from background.
  useEffect(() => {
    const handle = () => {
      if (document.hidden) {
        // App going to background — save position immediately
        if (book.source === 'server' && readingStateRef.current.cfi) {
          const { cfi, progress } = readingStateRef.current
          savePosition(book.id, cfi, progress).catch(() => {})
        }
      } else {
        // App returning to foreground — restore layout
        if (renditionRef.current && epubViewRef.current) {
          setTimeout(() => {
            try {
              renditionRef.current?.resize(
                epubViewRef.current!.clientWidth,
                epubViewRef.current!.clientHeight
              )
            } catch { /* ignore */ }
          }, 150)
        }
      }
    }
    document.addEventListener('visibilitychange', handle)
    return () => document.removeEventListener('visibilitychange', handle)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id, book.source])

  const TOO_LONG_RESULT: TranslationResult = {
    selected_span: '', best_result: '', alternatives: [],
    span_role: '', span_sense: '', span_confidence: null,
    improved_sentence: '', notes: 'TOO_LONG',
  }

  function isTooLong(text: string) {
    return text.trim().split(/\s+/).length > 8
  }

  async function handleTranslate() {
    if (!selection) return
    if (isTooLong(selection.text)) {
      setShowPanel(true)
      setTranslationResult({ ...TOO_LONG_RESULT, selected_span: selection.text })
      return
    }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setTranslating(true); setShowPanel(true); setTranslationResult(null); setStreamingText('')
    const s = settingsRef.current
    try {
      for await (const ev of translateStream(
        {
          selected_span: selection.text,
          target_sentence: selection.sentence,
          context_before: selection.contextBefore,
          context_after: selection.contextAfter,
          source_lang: s.sourceLang,
          target_lang: s.targetLang,
          context_mode: s.contextMode,
          model: s.model,
          temperature: 0.1,
          max_tokens: MAX_TOKENS[s.contextMode],
        },
        s.apiUrl, s.apiKey, ctrl.signal
      )) {
        if (ev.type === 'token') setStreamingText(prev => prev + ev.text)
        else if (ev.type === 'result') setTranslationResult(ev.data)
        else if (ev.type === 'error') throw new Error(ev.message)
      }
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') {
        setTranslationResult({
          selected_span: selection.text, best_result: '',
          alternatives: [], span_role: '', span_sense: '',
          span_confidence: null, improved_sentence: '',
          notes: 'Error: ' + String(err),
        })
      }
    } finally { setTranslating(false); setStreamingText('') }
  }

  // Pulsante fisso nella navbar — legge la selezione corrente dagli iframe
  // senza dipendere dagli eventi di selezione (workaround per iOS Safari).
  async function handleTranslateBtn() {
    const el = containerRef.current
    if (!el) return

    let data: SelectionState | null = null

    for (const iframe of el.querySelectorAll<HTMLIFrameElement>('iframe')) {
      try {
        const win = iframe.contentWindow
        if (!win) continue
        const sel = win.getSelection()
        if (!sel || sel.isCollapsed) continue
        const text = sel.toString().trim()
        if (!text) continue
        const block = getBlockText(sel.anchorNode)
        const { sentence, contextBefore, contextAfter } = extractContext(block, text, CONTEXT_CHARS[settingsRef.current.contextMode])
        data = {
          text, sentence, contextBefore, contextAfter,
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
          yBottom: window.innerHeight / 2 + 40,
        }
        break
      } catch { /* ignore */ }
    }

    // Fallback: usa la selezione già rilevata (desktop)
    data = data ?? selection
    if (!data) return

    setSelection(data)

    if (isTooLong(data.text)) {
      setShowPanel(true)
      setTranslationResult({ ...TOO_LONG_RESULT, selected_span: data.text })
      return
    }

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setTranslating(true); setShowPanel(true); setTranslationResult(null); setStreamingText('')
    const s = settingsRef.current
    try {
      for await (const ev of translateStream(
        {
          selected_span: data.text,
          target_sentence: data.sentence,
          context_before: data.contextBefore,
          context_after: data.contextAfter,
          source_lang: s.sourceLang,
          target_lang: s.targetLang,
          context_mode: s.contextMode,
          model: s.model,
          temperature: 0.1,
          max_tokens: MAX_TOKENS[s.contextMode],
        },
        s.apiUrl, s.apiKey, ctrl.signal
      )) {
        if (ev.type === 'token') setStreamingText(prev => prev + ev.text)
        else if (ev.type === 'result') setTranslationResult(ev.data)
        else if (ev.type === 'error') throw new Error(ev.message)
      }
    } catch (err: unknown) {
      if ((err as Error).name !== 'AbortError') {
        setTranslationResult({
          selected_span: data.text, best_result: '',
          alternatives: [], span_role: '', span_sense: '',
          span_confidence: null, improved_sentence: '',
          notes: 'Errore: ' + String(err),
        })
      }
    } finally { setTranslating(false); setStreamingText('') }
  }

  // Extend the selection by one word in the given direction.
  //
  // Reads from selectionSourceRef (our own stored copy) instead of the live
  // iframe selection — iOS clears that when any tap happens in the parent doc.
  // Updates selectionSourceRef synchronously so consecutive taps chain correctly.
  function expandSelection(dir: 'left' | 'right') {
    const src = selectionSourceRef.current
    if (!src) return

    const iframe = containerRef.current?.querySelector<HTMLIFrameElement>('iframe')
    if (!iframe?.contentDocument || !iframe.contentWindow) return
    const iDoc = iframe.contentDocument
    const iWin = iframe.contentWindow

    // Bail if the epub page turned and the text nodes are gone
    try {
      if (!iDoc.contains(src.startNode) || !iDoc.contains(src.endNode)) {
        selectionSourceRef.current = null
        return
      }
    } catch { return }

    const { startNode, startOffset, endNode, endOffset } = src
    let newStart = startOffset
    let newEnd   = endOffset

    // Scan the appropriate text node for the next word boundary
    if (dir === 'left') {
      const text = startNode.textContent ?? ''
      let o = newStart
      while (o > 0 && /\s/.test(text[o - 1])) o--
      while (o > 0 && /\S/.test(text[o - 1])) o--
      if (o === newStart) return
      newStart = o
    } else {
      const text = endNode.textContent ?? ''
      let o = newEnd
      while (o < text.length && /\s/.test(text[o])) o++
      while (o < text.length && /\S/.test(text[o])) o++
      if (o === newEnd) return
      newEnd = o
    }

    try {
      const range = iDoc.createRange()
      range.setStart(startNode, newStart)
      range.setEnd(endNode,     newEnd)

      // e.preventDefault() on the button's touchstart means the iframe never
      // lost focus, so addRange() restores the visible text highlight.
      iframe.focus()
      const sel = iWin.getSelection()
      if (!sel) return
      sel.removeAllRanges()
      sel.addRange(range)

      // Store new bounds — next tap reads from here, not from the live selection
      selectionSourceRef.current = {
        startNode, startOffset: newStart,
        endNode,   endOffset:   newEnd,
      }
      // selectionchange fires → debounced handler updates React state (toolbar text)
    } catch { /* stale node — page turned mid-expand */ }
  }

  function handleClosePanel() {
    abortRef.current?.abort()
    setShowPanel(false); setSelection(null); setTranslationResult(null); setStreamingText('')
    selectionSourceRef.current = null
  }

  // Anticipatory cache warming — extract notable words from the current
  // chapter and pre-translate them server-side, so a later tap is instant.
  function warmPageCache() {
    const el = containerRef.current
    const doc = el?.querySelector('iframe')?.contentDocument
    if (!doc?.body) return
    const text = doc.body.innerText || ''
    const seen = new Set<string>()
    const words: string[] = []
    // 5+ letter words (drops most function words), Unicode-aware
    for (const m of text.matchAll(/\p{L}{5,}/gu)) {
      const w = m[0].toLowerCase()
      if (seen.has(w)) continue
      seen.add(w)
      words.push(w)
      if (words.length >= 60) break
    }
    if (words.length === 0) return
    // Predictive glossing: words the user has looked up before go first,
    // so they win the backend's per-call translation budget.
    const hard = hardWordsRef.current
    if (hard.size > 0) {
      words.sort((a, b) => (hard.has(b) ? 1 : 0) - (hard.has(a) ? 1 : 0))
    }
    batchAbortRef.current?.abort()
    const ctrl = new AbortController()
    batchAbortRef.current = ctrl
    const s = settingsRef.current
    batchTranslate(words, s.sourceLang, s.targetLang, ctrl.signal).catch(() => {})
  }

  async function handleClose() {
    // Save position to IDB + server BEFORE switching to Library,
    // so the Library list shows updated progress immediately.
    clearTimeout(positionSyncTimerRef.current)
    const { cfi, progress: pct } = readingStateRef.current
    if (cfi) {
      await updateLastCfi(book.id, cfi)
      if (book.source === 'server') {
        try { await savePosition(book.id, cfi, pct) } catch { /* best effort */ }
      }
    }
    onClose()
  }

  function handleReaderSettingsChange(patch: Partial<Settings>) {
    const next = { ...settingsRef.current, ...patch }
    onSettingsChange(next)
    saveSettings(next)
  }

  function handleTocNav(href: string) {
    renditionRef.current?.display(href)
    setShowToc(false)
  }

  // Edge-strip swipe handlers — only used by the two 40px edge strips.
  // The centre area is overlay-free so iOS can natively select text, show
  // the "Copia / Cerca / Traduci" menu and drag the blue selection handles.
  function handleSwipeTouchStart(e: React.TouchEvent) {
    const { clientX, clientY } = e.touches[0]
    swipeTouchRef.current = { x: clientX, y: clientY, t: Date.now(), moved: false }
  }
  function handleSwipeTouchMove(e: React.TouchEvent) {
    const dx = e.touches[0].clientX - swipeTouchRef.current.x
    if (Math.abs(dx) > 5) swipeTouchRef.current = { ...swipeTouchRef.current, moved: true }
  }
  function handleSwipeTouchEnd(e: React.TouchEvent) {
    e.stopPropagation()   // prevent bubbling to the outer container handler
    if (showPanel) return
    const dx = e.changedTouches[0].clientX - swipeTouchRef.current.x
    const dy = e.changedTouches[0].clientY - swipeTouchRef.current.y
    const now = Date.now()
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) && now - lastSwipeRef.current > 600) {
      lastSwipeRef.current = now
      if (dx > 0) renditionRef.current?.prev()
      else renditionRef.current?.next()
    }
  }

  const canTranslate = !!settings.apiUrl
  const isSynonymMode = settings.sourceLang === settings.targetLang

  return (
    <div className="reader-page">
      {/* ── Navbar ── */}
      <div className="navbar">
        <button className="navbar-icon-btn" onClick={handleClose} title="Torna alla libreria">
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <span className="navbar-title">{book.title}</span>

        {/* TOC — capitoli */}
        <button
          className={`navbar-icon-btn ${showToc ? 'active-icon' : ''}`}
          onClick={() => { closeAllPanels(); setShowToc(v => !v) }}
          title="Capitoli"
        >
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <line x1="3" y1="6"  x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="15" y2="18" />
          </svg>
        </button>

        {/* Reader settings — Aa */}
        <button
          className={`navbar-icon-btn ${showReaderSettings ? 'active-icon' : ''}`}
          onClick={() => { closeAllPanels(); setShowReaderSettings(v => !v) }}
          title="Impostazioni lettura"
        >
          <svg width={20} height={20} viewBox="0 0 24 24">
            <text x="2" y="18" fontFamily="'Avenir Next',Georgia,serif" fontSize="14"
              stroke="none" fill="currentColor">Aa</text>
          </svg>
        </button>

        {/* Traduci — sempre visibile, legge la selezione corrente al tap */}
        <button
          className="navbar-icon-btn"
          onClick={handleTranslateBtn}
          disabled={!canTranslate}
          title={canTranslate ? (isSynonymMode ? 'Sinonimi per il testo selezionato' : 'Traduci testo selezionato') : 'Imposta URL e API key nelle Impostazioni'}
          style={{ fontWeight: 700, fontSize: 13, opacity: canTranslate ? 1 : 0.35 }}
        >
          {isSynonymMode ? 'S≡' : 'T→'}
        </button>

        {/* Ask the book — contextual chat (server books only) */}
        {book.source === 'server' && (
          <button
            className={`navbar-icon-btn ${showBookChat ? 'active-icon' : ''}`}
            onClick={() => { closeAllPanels(); setShowBookChat(v => !v) }}
            title="Chiedi al libro"
          >
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </button>
        )}

        {/* Favorites / Prontuario */}
        <button
          className={`navbar-icon-btn ${showFavorites ? 'active-icon' : ''}`}
          onClick={() => { closeAllPanels(); setShowFavorites(v => !v) }}
          title="Prontuario"
        >
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        </button>

        {/* Prev / Next */}
        <button className="navbar-icon-btn" onClick={() => renditionRef.current?.prev()} title="Pagina precedente">
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <button className="navbar-icon-btn" onClick={() => renditionRef.current?.next()} title="Pagina successiva">
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* ── Reader settings panel (inline, below navbar) ── */}
      {showReaderSettings && (
        <ReaderSettingsPanel
          settings={settings}
          onChange={handleReaderSettingsChange}
          onClose={() => setShowReaderSettings(false)}
        />
      )}

      {/* ── Resume toast ── */}
      {resumeToast && (
        <div style={{
          position: 'fixed', bottom: 72, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 20, padding: '6px 16px',
          fontSize: 12, color: 'var(--text-muted)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          zIndex: 200, pointerEvents: 'none',
          whiteSpace: 'nowrap',
        }}>
          Posizione ripristinata
        </div>
      )}

      {/* ── EPUB viewport ── */}
      <div className="epub-container" ref={containerRef}>
        {/* Inner div: epub renders here with 20px horizontal inset.
            epub.js measures this div's clientWidth/Height for pagination,
            so it lays out text into the correct narrower column width —
            giving natural side margins without any body-padding tricks. */}
        <div className="epub-inner" ref={epubViewRef} />

        {/* Left edge strip — catches swipe-right (prev page).
            Only 40px wide so the centre is fully free for native iOS text selection
            (long-press magnifier, double-tap word select, blue drag handles,
            and the system "Copia / Cerca" context menu all work unobstructed). */}
        <div
          style={{
            position: 'absolute', top: 0, bottom: 0, left: 0, width: 40,
            zIndex: 5, touchAction: 'none',
            pointerEvents: showPanel ? 'none' : 'auto',
          }}
          onTouchStart={handleSwipeTouchStart}
          onTouchMove={handleSwipeTouchMove}
          onTouchEnd={handleSwipeTouchEnd}
        />
        {/* Right edge strip — catches swipe-left (next page). */}
        <div
          style={{
            position: 'absolute', top: 0, bottom: 0, right: 0, width: 40,
            zIndex: 5, touchAction: 'none',
            pointerEvents: showPanel ? 'none' : 'auto',
          }}
          onTouchStart={handleSwipeTouchStart}
          onTouchMove={handleSwipeTouchMove}
          onTouchEnd={handleSwipeTouchEnd}
        />
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
      </div>

      {/* ── Progress ── */}
      {!loading && (
        <div className="reader-progress">
          {location ? (progress > 0 || locationsReadyRef.current ? `${progress}%` : '…') : ''}
        </div>
      )}

      {/* ── Translation panel ── */}
      {showPanel && selection && (
        <TranslationPanel
          selectedText={selection.text}
          result={translationResult}
          loading={translating}
          streamingText={streamingText}
          apiUrl={settings.apiUrl}
          apiKey={settings.apiKey}
          onClose={handleClosePanel}
        />
      )}

      {/* ── TOC sheet ── */}
      {showToc && (
        <TocSheet toc={toc} onNavigate={handleTocNav} onClose={() => setShowToc(false)} />
      )}

      {/* ── Favorites sheet ── */}
      {showFavorites && (
        <FavoritesSheet onClose={() => setShowFavorites(false)} />
      )}

      {/* ── Book chat sheet ── */}
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

// ─── TOC sheet ────────────────────────────────────────────────────────────────

function TocSheet({ toc, onNavigate, onClose }: {
  toc: TocItem[]
  onNavigate: (href: string) => void
  onClose: () => void
}) {
  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">Capitoli</span>
          <button className="navbar-icon-btn" onClick={onClose}>
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="sheet-body" style={{ padding: 0 }}>
          {toc.length === 0 ? (
            <div className="empty-state" style={{ padding: '40px 24px' }}>
              <h3>Nessun capitolo disponibile</h3>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {toc.map((item, i) => (
                <button
                  key={`${item.href}-${i}`}
                  className="toc-item"
                  style={{ paddingLeft: 16 + item.level * 20 }}
                  onClick={() => onNavigate(item.href)}
                >
                  <span className="toc-label">{item.label.trim()}</span>
                  <svg width={16} height={16} viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth={2} style={{ flexShrink: 0, opacity: 0.4 }}>
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Reader settings panel ────────────────────────────────────────────────────

const FONT_FAMILIES: { name: FontFamily; label: string }[] = [
  { name: 'Avenir Next', label: 'Avenir' },
  { name: 'Georgia',     label: 'Georgia' },
  { name: 'Palatino',   label: 'Palatino' },
  { name: 'Times',      label: 'Times' },
  { name: 'Charter',    label: 'Charter' },
  { name: 'Helvetica',  label: 'Helvetica' },
  { name: 'System',     label: 'System' },
]

function ReaderSettingsPanel({
  settings, onChange, onClose
}: {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  onClose: () => void
}) {
  return (
    <div className="reader-settings-panel" onClick={onClose}>
      <div className="reader-settings-inner" onClick={e => e.stopPropagation()}>

        {/* Theme */}
        <div className="rs-row">
          <span className="rs-label">Tema</span>
          <div className="theme-row" style={{ flex: 1 }}>
            {(['light', 'sepia', 'dark'] as Theme[]).map(t => (
              <button
                key={t}
                className={`theme-btn ${t} ${settings.theme === t ? 'active' : ''}`}
                style={{ padding: '8px 4px', fontSize: 12 }}
                onClick={() => onChange({ theme: t })}
              >
                {t === 'light' ? 'Chiaro' : t === 'sepia' ? 'Seppia' : 'Scuro'}
              </button>
            ))}
          </div>
        </div>

        <div className="rs-divider" />

        {/* Font family */}
        <div className="rs-row">
          <span className="rs-label">Font</span>
          <div style={{ display: 'flex', gap: 6, flex: 1, flexWrap: 'wrap' }}>
            {FONT_FAMILIES.map(({ name, label }) => (
              <button
                key={name}
                className={`font-chip ${settings.fontFamily === name ? 'active' : ''}`}
                style={{ fontFamily: FONT_CSS[name] }}
                onClick={() => onChange({ fontFamily: name })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="rs-divider" />

        {/* Font size */}
        <div className="rs-row">
          <span className="rs-label">Dim. {settings.fontSize}px</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
            <button className="rs-step-btn"
              onClick={() => onChange({ fontSize: Math.max(14, settings.fontSize - 1) })}>−</button>
            <input type="range" min={14} max={32} step={1}
              value={settings.fontSize}
              onChange={e => onChange({ fontSize: Number(e.target.value) })}
              style={{ flex: 1 }} />
            <button className="rs-step-btn"
              onClick={() => onChange({ fontSize: Math.min(32, settings.fontSize + 1) })}>+</button>
          </div>
        </div>

        <div className="rs-divider" />

        {/* Line height */}
        <div className="rs-row">
          <span className="rs-label">Interl. {settings.lineHeight.toFixed(1)}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
            <button className="rs-step-btn"
              onClick={() => onChange({ lineHeight: Math.max(1.2, Math.round((settings.lineHeight - 0.1) * 10) / 10) })}>−</button>
            <input type="range" min={1.2} max={2.0} step={0.1}
              value={settings.lineHeight}
              onChange={e => onChange({ lineHeight: Number(e.target.value) })}
              style={{ flex: 1 }} />
            <button className="rs-step-btn"
              onClick={() => onChange({ lineHeight: Math.min(2.0, Math.round((settings.lineHeight + 0.1) * 10) / 10) })}>+</button>
          </div>
        </div>

        <div className="rs-divider" />

        {/* Modello */}
        <div className="rs-row">
          <span className="rs-label" style={{ minWidth: 52 }}>Modello</span>
          <select
            style={{ flex: 1, fontSize: 13, padding: '5px 8px', borderRadius: 8,
              border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
            value={settings.model}
            onChange={e => onChange({ model: e.target.value })}
          >
            {AGENT_MODELS.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>

        <div className="rs-divider" />

        {/* Lingue */}
        <div className="rs-row">
          <span className="rs-label" style={{ minWidth: 52 }}>Lingue</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
            <select
              style={{ flex: 1, fontSize: 13, padding: '5px 6px', borderRadius: 8,
                border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
              value={settings.sourceLang}
              onChange={e => onChange({ sourceLang: e.target.value })}
            >
              {Object.entries(SUPPORTED_LANGS).map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </select>
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>→</span>
            <select
              style={{ flex: 1, fontSize: 13, padding: '5px 6px', borderRadius: 8,
                border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
              value={settings.targetLang}
              onChange={e => onChange({ targetLang: e.target.value })}
            >
              {Object.entries(SUPPORTED_LANGS).map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </select>
          </div>
        </div>


      </div>
    </div>
  )
}

// ─── Favorites sheet ──────────────────────────────────────────────────────────

function FavoritesSheet({ onClose }: { onClose: () => void }) {
  const [favorites, setFavorites] = useState<FavoriteWord[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    getFavorites().then(f => { setFavorites(f); setLoading(false) })
  }, [])

  async function handleDelete(id: string) {
    await deleteFavorite(id)
    setFavorites(prev => prev.filter(f => f.id !== id))
  }

  const filtered = search
    ? favorites.filter(f =>
        f.word.toLowerCase().includes(search.toLowerCase()) ||
        f.translation.toLowerCase().includes(search.toLowerCase()))
    : favorites

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">Prontuario</span>
          <button className="navbar-icon-btn" onClick={onClose}>
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)' }}>
          <input className="form-input" type="search" placeholder="Cerca parole…"
            value={search} onChange={e => setSearch(e.target.value)} style={{ width: '100%' }} />
        </div>
        <div className="sheet-body" style={{ padding: 0 }}>
          {loading ? (
            <div className="spinner-wrap"><div className="spinner" /></div>
          ) : filtered.length === 0 ? (
            <div className="empty-state" style={{ padding: '40px 24px' }}>
              <h3>{search ? 'Nessun risultato' : 'Nessuna parola salvata'}</h3>
              <p>{search ? 'Prova un termine diverso.' : 'Salva parole con ★ durante la traduzione.'}</p>
            </div>
          ) : (
            <div className="fav-list">
              {filtered.map(fav => (
                <div key={fav.id} className="fav-item">
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                      <span className="fav-word">{fav.word}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>←</span>
                      <span className="fav-translation">{fav.translation}</span>
                    </div>
                    {fav.alternatives.length > 0 && (
                      <div className="fav-alternatives">alt: {fav.alternatives.join(', ')}</div>
                    )}
                    {fav.sentence_it && <div className="fav-sentence">{fav.sentence_it}</div>}
                  </div>
                  <button className="fav-delete-btn" onClick={() => handleDelete(fav.id)}>
                    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
