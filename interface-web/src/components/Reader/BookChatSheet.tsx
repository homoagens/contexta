import { useState, useEffect, useRef } from 'react'
import { fetchBookKb, bookChat, type BookKb } from '../../api/translate'

interface Props {
  bookId: string
  progress: number      // 0-100, used to clip chapter context (spoiler-safe)
  targetLang: string
  onClose: () => void
}

interface Msg {
  role: 'user' | 'assistant'
  text: string
}

export default function BookChatSheet({ bookId, progress, targetLang, onClose }: Props) {
  const [kb, setKb] = useState<BookKb | null>(null)
  const [kbError, setKbError] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [persona, setPersona] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  function loadKb() {
    setKbError(false)
    fetchBookKb(bookId).then(setKb).catch(() => setKbError(true))
  }

  useEffect(() => {
    loadKb()
    return () => abortRef.current?.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, sending])

  const ready = kb?.status === 'ready' && kb.kb != null

  async function send() {
    const q = input.trim()
    if (!q || sending || !ready) return
    setInput('')
    setMessages(m => [...m, { role: 'user', text: q }])
    setSending(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    // Clip chapter context to where the reader currently is
    const totalCh = kb?.kb?.chapters.length ?? 0
    const upTo = totalCh > 0
      ? Math.max(0, Math.ceil((progress / 100) * totalCh) - 1)
      : null
    try {
      const answer = await bookChat(bookId, q, persona, upTo, targetLang, ctrl.signal)
      setMessages(m => [...m, { role: 'assistant', text: answer }])
    } catch (err) {
      const msg = err instanceof Error && err.message === 'kb_not_ready'
        ? 'Il libro è ancora in analisi. Riprova tra poco.'
        : 'Errore nella risposta. Riprova.'
      setMessages(m => [...m, { role: 'assistant', text: msg }])
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', maxHeight: '80vh' }}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title">{persona ? 'Parla col libro' : 'Chiedi al libro'}</span>
          <button className="navbar-icon-btn" onClick={onClose}>
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Persona toggle */}
        <div style={{ display: 'flex', gap: 8, padding: '4px 16px 8px' }}>
          <button
            onClick={() => setPersona(false)}
            style={{
              flex: 1, padding: '7px 0', fontSize: 13, fontWeight: 600,
              borderRadius: 8, cursor: 'pointer',
              border: persona ? '1px solid var(--border)' : '1px solid var(--accent)',
              background: persona ? 'transparent' : 'var(--accent)',
              color: persona ? 'var(--text-muted)' : '#fff',
            }}
          >Compagno di lettura</button>
          <button
            onClick={() => setPersona(true)}
            style={{
              flex: 1, padding: '7px 0', fontSize: 13, fontWeight: 600,
              borderRadius: 8, cursor: 'pointer',
              border: persona ? '1px solid var(--accent)' : '1px solid var(--border)',
              background: persona ? 'var(--accent)' : 'transparent',
              color: persona ? '#fff' : 'var(--text-muted)',
            }}
          >Parla come il libro</button>
        </div>

        {/* Body */}
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '8px 16px', minHeight: 120 }}>
          {kbError && (
            <div className="empty-state" style={{ padding: 20 }}>
              <p>Impossibile caricare l'analisi del libro.</p>
              <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={loadKb}>Riprova</button>
            </div>
          )}
          {!kbError && !ready && (
            <div className="empty-state" style={{ padding: 20 }}>
              <div className="spinner" style={{ margin: '0 auto 12px' }} />
              <p>Sto leggendo il libro per poterne parlare con te…</p>
              <button className="btn" style={{ marginTop: 8 }} onClick={loadKb}>Aggiorna</button>
            </div>
          )}
          {ready && messages.length === 0 && (
            <div className="empty-state" style={{ padding: 20 }}>
              <p>{persona
                ? 'Fai una domanda — ti risponderò con la voce del libro.'
                : 'Chiedimi della trama, dei personaggi o di un capitolo.'}</p>
            </div>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              style={{
                margin: '6px 0', display: 'flex',
                justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
              }}
            >
              <div style={{
                maxWidth: '82%', padding: '8px 12px', borderRadius: 14,
                fontSize: 14, lineHeight: 1.45, whiteSpace: 'pre-wrap',
                background: m.role === 'user' ? 'var(--accent)' : 'var(--surface)',
                color: m.role === 'user' ? '#fff' : 'var(--text)',
                border: m.role === 'user' ? 'none' : '1px solid var(--border)',
              }}>{m.text}</div>
            </div>
          ))}
          {sending && (
            <div style={{ margin: '6px 0', display: 'flex', justifyContent: 'flex-start' }}>
              <div style={{
                padding: '8px 12px', borderRadius: 14, fontSize: 14,
                background: 'var(--surface)', border: '1px solid var(--border)',
                color: 'var(--text-muted)',
              }}>…</div>
            </div>
          )}
        </div>

        {/* Input */}
        <div style={{ display: 'flex', gap: 8, padding: '8px 16px 16px' }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') send() }}
            disabled={!ready || sending}
            placeholder={ready ? 'Scrivi una domanda…' : 'In attesa dell’analisi…'}
            style={{
              flex: 1, padding: '10px 12px', fontSize: 14, borderRadius: 10,
              border: '1px solid var(--border)', background: 'var(--bg)',
              color: 'var(--text)',
            }}
          />
          <button
            className="btn btn-primary"
            onClick={send}
            disabled={!ready || sending || !input.trim()}
            style={{ padding: '0 18px' }}
          >Invia</button>
        </div>
      </div>
    </div>
  )
}
