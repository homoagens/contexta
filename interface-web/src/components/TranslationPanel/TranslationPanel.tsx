import { useState, useRef } from 'react'
import { saveFavorite, getFavorites, deleteFavorite } from '../../store/db'
import { chatContext } from '../../api/translate'
import type { TranslationResult, FavoriteWord } from '../../types'
import { SUPPORTED_LANGS } from '../../types'

interface Props {
  selectedText: string
  result: TranslationResult | null
  loading: boolean
  streamingText?: string  // raw LLM token stream, shown while loading
  onClose: () => void
  apiUrl: string
  apiKey: string
}

// ─── Field helpers ───────────────────────────────────────────────────────────

function rSpan(r: TranslationResult): string {
  return r.selected_span || ''
}
function rBest(r: TranslationResult): string {
  return r.best_result || ''
}
function rAlts(r: TranslationResult): string[] {
  return r.alternatives ?? []
}
function rSense(r: TranslationResult): string {
  return r.span_sense || ''
}
function rSentence(r: TranslationResult): string {
  return r.improved_sentence || ''
}
function rMode(r: TranslationResult): string {
  return r.mode || 'translate'
}

export default function TranslationPanel({ selectedText, result, loading, streamingText, onClose, apiUrl, apiKey }: Props) {
  const [savedFavId, setSavedFavId] = useState<string | null>(null)
  const [savingFav, setSavingFav] = useState(false)

  async function handleToggleFavorite() {
    if (!result) return
    if (savedFavId) {
      // Already saved — remove
      await deleteFavorite(savedFavId)
      setSavedFavId(null)
      return
    }

    setSavingFav(true)
    try {
      // Check if already exists
      const existing = await getFavorites()
      const best = rBest(result)
      const dup = existing.find(f => f.word.toLowerCase() === best.toLowerCase())
      if (dup) {
        setSavedFavId(dup.id)
        setSavingFav(false)
        return
      }

      const fav: FavoriteWord = {
        id: crypto.randomUUID(),
        word: best,
        translation: rSpan(result),
        alternatives: rAlts(result),
        sense: rSense(result),
        evidence: '',
        sentence_it: rSentence(result),
        createdAt: Date.now(),
      }
      await saveFavorite(fav)
      setSavedFavId(fav.id)
    } finally {
      setSavingFav(false)
    }
  }

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <span className="sheet-title" style={{ fontStyle: 'italic', fontWeight: 400, fontSize: 14, color: 'var(--text-muted)', maxWidth: '70%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            "{selectedText}"
          </span>
          <button className="navbar-icon-btn" onClick={onClose}>
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="sheet-body">
          {loading && (
            <div style={{ padding: '16px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: streamingText ? 10 : 0 }}>
                <div className="spinner" style={{ width: 16, height: 16, flexShrink: 0 }} />
                <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                  Translating…
                </span>
              </div>
              {streamingText && (
                <div style={{
                  fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.45,
                  background: 'var(--surface)', borderRadius: 6, padding: '8px 10px',
                  maxHeight: 110, overflow: 'hidden', opacity: 0.75,
                }}>
                  {streamingText}
                </div>
              )}
            </div>
          )}

          {!loading && result && (
            <TranslationContent
              result={result}
              savedFavId={savedFavId}
              savingFav={savingFav}
              onToggleFavorite={handleToggleFavorite}
              apiUrl={apiUrl}
              apiKey={apiKey}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function TranslationContent({
  result,
  savedFavId,
  savingFav,
  onToggleFavorite,
  apiUrl,
  apiKey,
}: {
  result: TranslationResult
  savedFavId: string | null
  savingFav: boolean
  onToggleFavorite: () => void
  apiUrl: string
  apiKey: string
}) {
  const [activeAlt, setActiveAlt] = useState<string | null>(null)
  const best = rBest(result)
  const alts = rAlts(result)
  const sense = rSense(result)
  const sentence = rSentence(result)
  const mode = rMode(result)
  const isSynonym = mode === 'synonym'

  const displayTranslation = activeAlt ?? best
  const labels = getLabels(result.target_lang || 'it')

  // Target language label
  const targetLabel = result.target_lang
    ? SUPPORTED_LANGS[result.target_lang] ?? result.target_lang.toUpperCase()
    : null

  if (result.notes === 'TOO_LONG') {
    return (
      <div style={{ textAlign: 'center', padding: '28px 12px' }}>
        <div style={{ fontSize: 36, marginBottom: 14 }}>📖</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 10 }}>
          Sono un umile assistente, non un traduttore!
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.7 }}>
          Posso aiutarti con <strong>una parola</strong> o al massimo una <strong>locuzione di 4 parole</strong>
          {' '}(es. <em>«black market»</em>, <em>«put up with»</em>).<br />
          Per frasi e paragrafi interi ti consiglio Google Translate. 😊
        </div>
      </div>
    )
  }

  if (result.notes?.startsWith('Error:') || result.notes?.startsWith('Errore:')) {
    return (
      <div style={{ color: 'var(--danger)', fontSize: 14, padding: '8px 0' }}>
        {result.notes}
      </div>
    )
  }

  if (!best) {
    return (
      <div style={{ color: 'var(--text-muted)', fontSize: 14, padding: '8px 0' }}>
        {isSynonym ? 'No synonyms returned.' : 'No translation returned.'}
      </div>
    )
  }

  return (
    <div>
      {/* Main translation/synonym + alternatives */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--accent)', marginBottom: 6 }}>
            {displayTranslation}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 0 }}>
            {/* "Best" chip */}
            <button
              className={`translation-chip ${!activeAlt ? 'active' : ''}`}
              onClick={() => setActiveAlt(null)}
            >
              {best}
            </button>
            {/* Alternative chips */}
            {alts.map((alt, i) => (
              <button
                key={i}
                className={`translation-chip ${activeAlt === alt ? 'active' : ''}`}
                onClick={() => setActiveAlt(alt === activeAlt ? null : alt)}
              >
                {alt}
              </button>
            ))}
          </div>
        </div>

        {/* Favorite button */}
        <button
          className={`fav-btn ${savedFavId ? 'saved' : ''}`}
          onClick={onToggleFavorite}
          disabled={savingFav}
          title={savedFavId ? 'Remove from favorites' : 'Save to favorites'}
        >
          <svg width={16} height={16} viewBox="0 0 24 24"
            fill={savedFavId ? 'currentColor' : 'none'}
            stroke="currentColor" strokeWidth={2}
          >
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          {savedFavId ? 'Saved' : 'Save'}
        </button>
      </div>

      {/* Role / POS tag */}
      {result.span_role && result.span_role !== 'UNKNOWN' && (
        <div style={{ marginBottom: 10 }}>
          <span className="tag-chip">{result.span_role}</span>
          {result.span_confidence != null && (
            <span className="tag-chip" style={{ marginLeft: 6 }}>
              {Math.round(result.span_confidence * 100)}%
            </span>
          )}
          {isSynonym && <span className="tag-chip" style={{ marginLeft: 6 }}>synonym</span>}
        </div>
      )}

      {/* Sense */}
      {sense && (
        <div style={{ marginBottom: 10 }}>
          <div className="section-header">{labels.meaning}</div>
          <div style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.5 }}>
            {sense}
          </div>
        </div>
      )}

      {/* Sentence in target language */}
      {sentence && (
        <div style={{ marginBottom: 10 }}>
          <div className="section-header">
            {isSynonym ? labels.improvedSentence : targetLabel ? `In ${targetLabel}` : labels.improvedSentence}
          </div>
          <div className="translation-sentence">
            {highlightWord(sentence, displayTranslation)}
          </div>
        </div>
      )}

      {/* Notes */}
      {result.notes && !result.notes.startsWith('Error:') && !result.notes.startsWith('Errore:') && (
        <div style={{ marginTop: 12 }}>
          <div className="section-header">Notes</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            {result.notes}
          </div>
        </div>
      )}

      {/* Ask AI section */}
      <ChatSection result={result} apiUrl={apiUrl} apiKey={apiKey} />

      {/* Model badge */}
      {result.translated_by && (() => {
        const name = result.translated_by.toLowerCase()
        const isGemma = name.includes('gemma')
        const isOss   = name.includes('oss-gpt') || name.includes('gpt-oss')
        const color   = isGemma ? '#3b82f6' : isOss ? '#f59e0b' : 'var(--text-muted)'
        const bg      = isGemma ? 'rgba(59,130,246,0.1)' : isOss ? 'rgba(245,158,11,0.1)' : 'var(--surface-2, rgba(0,0,0,0.05))'
        const border  = isGemma ? 'rgba(59,130,246,0.35)' : isOss ? 'rgba(245,158,11,0.35)' : 'var(--border)'
        return (
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 10, fontWeight: 500, letterSpacing: '0.04em',
              color, background: bg, border: `1px solid ${border}`,
              borderRadius: 20, padding: '2px 8px',
              textTransform: 'uppercase',
            }}>
              <svg width={9} height={9} viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.7 }}>
                <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z" />
              </svg>
              {result.translated_by}
            </span>
          </div>
        )
      })()}
    </div>
  )
}

// ─── Chat section ─────────────────────────────────────────────────────────────

// ─── UI labels per target language ───────────────────────────────────────────

type UiLabels = {
  meaning: string
  improvedSentence: string
  askAI: string
  askPlaceholder: string
  thinking: string
}

const UI_LABELS: Record<string, UiLabels> = {
  it: { meaning: 'Significato', improvedSentence: 'Frase migliorata', askAI: 'Chiedi a Gemma', askPlaceholder: 'Fai una domanda…', thinking: 'Elaboro…' },
  en: { meaning: 'Meaning',     improvedSentence: 'Improved sentence', askAI: 'Ask Gemma',      askPlaceholder: 'Ask a question…',   thinking: 'Thinking…' },
  de: { meaning: 'Bedeutung',   improvedSentence: 'Verbesserter Satz', askAI: 'Frag Gemma',     askPlaceholder: 'Stell eine Frage…', thinking: 'Überlege…' },
  fr: { meaning: 'Signification', improvedSentence: 'Phrase améliorée', askAI: 'Demande à Gemma', askPlaceholder: 'Pose une question…', thinking: 'Réfléchis…' },
  es: { meaning: 'Significado', improvedSentence: 'Frase mejorada',    askAI: 'Pregunta a Gemma', askPlaceholder: 'Haz una pregunta…', thinking: 'Pensando…' },
}

function getLabels(targetLang: string): UiLabels {
  return UI_LABELS[targetLang] ?? UI_LABELS['en']
}

// ─── Quick questions per target language ─────────────────────────────────────

type QuickQ = { label: string; prompt: string }

function getQuickQuestions(targetLang: string): QuickQ[] {
  if (targetLang === 'de') return [
    { label: 'Vertiefen', prompt: 'In 3 Sätzen: Welche Nuance oder welches Register macht dieses Wort anders als seine nächsten Synonyme, und wann ist es die beste Wahl?' },
    { label: 'Weitere Synonyme', prompt: 'Liste 4 alternative Übersetzungen auf. Eine pro Zeile: Wort, Bindestrich, maximal 5 Wörter zum Unterschied.' },
    { label: 'Im Satz', prompt: 'Schreibe genau 3 kurze Beispielsätze mit diesem Wort. Nur die 3 Sätze, kein anderer Text.' },
    { label: 'Grammatik', prompt: '' },
  ]
  if (targetLang === 'fr') return [
    { label: 'Approfondir', prompt: 'En 3 phrases: quelle nuance ou quel registre distingue ce mot de ses synonymes les plus proches, et quand est-il le meilleur choix?' },
    { label: 'Autres synonymes', prompt: 'Liste 4 traductions alternatives. Une par ligne: mot, tiret, 5 mots max sur la différence.' },
    { label: 'Dans une phrase', prompt: 'Écris exactement 3 courtes phrases d\'exemple avec ce mot. Seulement les 3 phrases, aucun autre texte.' },
    { label: 'Grammaire', prompt: '' },
  ]
  if (targetLang === 'es') return [
    { label: 'Profundiza', prompt: 'En 3 frases: ¿qué matiz o registro distingue esta palabra de sus sinónimos más cercanos, y cuándo es la mejor opción?' },
    { label: 'Más sinónimos', prompt: 'Lista 4 traducciones alternativas. Una por línea: palabra, guion, máximo 5 palabras sobre la diferencia.' },
    { label: 'Úsalo en una frase', prompt: 'Escribe exactamente 3 frases de ejemplo cortas con esta palabra. Solo las 3 frases, ningún otro texto.' },
    { label: 'Gramática', prompt: '' },
  ]
  if (targetLang === 'en') return [
    { label: 'Expand', prompt: 'In 3 sentences: what nuance or register makes this word different from its closest synonyms, and when is it the best choice?' },
    { label: 'More synonyms', prompt: 'List 4 alternative translations. One per line: word, dash, 5 words max on the difference.' },
    { label: 'Use in a sentence', prompt: 'Write exactly 3 short example sentences with this word. Only the 3 sentences, no other text.' },
    { label: 'Grammar', prompt: '' },
  ]
  // Italian (default)
  return [
    { label: 'Approfondisci', prompt: 'In 3 frasi: quale sfumatura o registro rende questa parola diversa dai sinonimi più vicini, e quando è la scelta migliore?' },
    { label: 'Altri sinonimi', prompt: 'Elenca 4 sinonimi o traduzioni alternative. Una per riga: parola, trattino, massimo 5 parole su come si distingue.' },
    { label: 'Usalo in una frase', prompt: 'Scrivi esattamente 3 brevi frasi d\'esempio con questa parola. Solo le 3 frasi, nessun altro testo.' },
    { label: 'Grammatica', prompt: '' },
  ]
}

function grammaticaPrompt(result: TranslationResult): string {
  const role = result?.span_role || ''
  const word = result?.best_result || ''
  if (role === 'VERB')
    return `"${word}" is a verb. Output exactly this format: "infinito: X | io: X | tu: X | lui: X | participio: X". Fill in the real forms. No other text.`
  if (role === 'NOUN')
    return `"${word}" is a noun. Output exactly this format: "genere: X | singolare: X | plurale: X". Fill in the real forms. No other text.`
  if (role === 'ADJ')
    return `"${word}" is an adjective. Output exactly this format: "m.s.: X | f.s.: X | m.pl.: X | f.pl.: X". Fill in the real forms. No other text.`
  return `Give the grammatical forms of "${word}" (${role || 'unknown part of speech'}). Label each form. No other text.`
}

function ChatSection({ result, apiUrl, apiKey }: {
  result: TranslationResult
  apiUrl: string
  apiKey: string
}) {
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const labels = getLabels(result.target_lang || 'it')

  async function ask(q: string, constrained = true) {
    if (!q.trim() || loading) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true); setAnswer(''); setError('')
    try {
      const a = await chatContext(result, q, apiUrl, apiKey, ctrl.signal, constrained)
      setAnswer(a)
    } catch (e: unknown) {
      if ((e as Error).name !== 'AbortError') setError(String(e))
    } finally { setLoading(false) }
  }

  if (!open) {
    return (
      <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <button
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 13, color: 'var(--accent)', padding: 0,
            display: 'flex', alignItems: 'center', gap: 4,
          }}
          onClick={() => setOpen(true)}
        >
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          {labels.askAI}
        </button>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{labels.askAI}</span>
        <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18, lineHeight: 1 }} onClick={() => setOpen(false)}>×</button>
      </div>

      {/* Quick buttons */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {getQuickQuestions(result.target_lang || 'it').map(q => (
          <button
            key={q.label}
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: '4px 10px' }}
            onClick={() => { setQuestion(''); ask(q.prompt ? q.prompt : grammaticaPrompt(result)) }}
            disabled={loading}
          >{q.label}</button>
        ))}
      </div>

      {/* Free input */}
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          className="form-input"
          style={{ flex: 1, fontSize: 13, padding: '6px 10px' }}
          placeholder={labels.askPlaceholder}
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { ask(question, false); setQuestion('') } }}
          disabled={loading}
        />
        <button
          className="btn btn-primary"
          style={{ fontSize: 13, padding: '6px 12px' }}
          onClick={() => { ask(question, false); setQuestion('') }}
          disabled={loading || !question.trim()}
        >{loading ? '…' : '→'}</button>
      </div>

      {/* Answer */}
      {loading && <div style={{ marginTop: 10, color: 'var(--text-muted)', fontSize: 13 }}>{labels.thinking}</div>}
      {answer && (
        <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.6, color: 'var(--text)', background: 'var(--surface)', borderRadius: 8, padding: '10px 12px', maxHeight: 220, overflowY: 'auto' }}>
          {answer}
        </div>
      )}
      {error && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
    </div>
  )
}

function highlightWord(sentence: string, word: string): React.ReactNode {
  if (!word) return sentence
  const idx = sentence.toLowerCase().indexOf(word.toLowerCase())
  if (idx < 0) return sentence
  return (
    <>
      {sentence.slice(0, idx)}
      <strong style={{ color: 'var(--accent)' }}>{sentence.slice(idx, idx + word.length)}</strong>
      {sentence.slice(idx + word.length)}
    </>
  )
}
