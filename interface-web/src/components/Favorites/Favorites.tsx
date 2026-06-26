import { useState, useEffect } from 'react'
import { getFavorites, deleteFavorite, saveFavorite } from '../../store/db'
import type { FavoriteWord } from '../../types'
import { schedule, isDue, intervalPreview, type Rating } from '../../store/srs'
import { t } from '../../i18n'

interface Props {
  lang?: string
}

export default function Favorites({ lang = 'en' }: Props) {
  const [favorites, setFavorites] = useState<FavoriteWord[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [reviewing, setReviewing] = useState(false)

  useEffect(() => {
    getFavorites().then(f => {
      setFavorites(f)
      setLoading(false)
    })
  }, [])

  async function handleDelete(id: string) {
    await deleteFavorite(id)
    setFavorites(prev => prev.filter(f => f.id !== id))
  }

  const dueCards = favorites.filter(f => isDue(f.srs))

  // Persist an SRS update coming back from the review session
  function applyReview(updated: FavoriteWord) {
    setFavorites(prev => prev.map(f => (f.id === updated.id ? updated : f)))
    saveFavorite(updated).catch(() => {})
  }

  if (reviewing) {
    return (
      <ReviewSession
        cards={dueCards}
        lang={lang}
        onReviewed={applyReview}
        onDone={() => setReviewing(false)}
      />
    )
  }

  const filtered = search
    ? favorites.filter(f =>
        f.word.toLowerCase().includes(search.toLowerCase()) ||
        f.translation.toLowerCase().includes(search.toLowerCase())
      )
    : favorites

  return (
    <>
      <div className="navbar">
        <span className="navbar-title">{t('tab.glossary', lang)}</span>
        {dueCards.length > 0 && (
          <button
            className="btn btn-primary"
            style={{ padding: '7px 14px', fontSize: 13 }}
            onClick={() => setReviewing(true)}
          >
            Ripasso ({dueCards.length})
          </button>
        )}
      </div>

      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
        <input
          className="form-input"
          type="search"
          placeholder={t('fav.search', lang)}
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '100%' }}
        />
      </div>

      {loading ? (
        <div className="spinner-wrap"><div className="spinner" /></div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <svg width={52} height={52} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          <h3>{search ? t('fav.no_results', lang) : t('fav.no_words', lang)}</h3>
          <p>{search ? t('fav.hint_search', lang) : t('fav.hint_empty', lang)}</p>
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
                  {isDue(fav.srs) && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, color: 'var(--accent)',
                      border: '1px solid var(--accent)', borderRadius: 6, padding: '1px 5px',
                    }}>da ripassare</span>
                  )}
                </div>
                {fav.alternatives.length > 0 && (
                  <div className="fav-alternatives">alt: {fav.alternatives.join(', ')}</div>
                )}
                {fav.sense && (
                  <div className="fav-alternatives" style={{ marginTop: 2 }}>{fav.sense}</div>
                )}
                {fav.sentence_it && (
                  <div className="fav-sentence">{fav.sentence_it}</div>
                )}
              </div>
              <button
                className="fav-delete-btn"
                onClick={() => handleDelete(fav.id)}
                title={t('fav.remove', lang)}
              >
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// ─── Spaced-repetition review session ───────────────────────────────────────

const RATINGS: { id: Rating; label: string; color: string }[] = [
  { id: 'again', label: 'Ancora',   color: '#e05555' },
  { id: 'hard',  label: 'Difficile', color: '#d98a3a' },
  { id: 'good',  label: 'Bene',      color: '#3a9d6a' },
  { id: 'easy',  label: 'Facile',    color: '#3a7fd9' },
]

function ReviewSession({
  cards, lang, onReviewed, onDone,
}: {
  cards: FavoriteWord[]
  lang: string
  onReviewed: (f: FavoriteWord) => void
  onDone: () => void
}) {
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [done, setDone] = useState(0)

  const card = cards[index]

  function rate(r: Rating) {
    if (!card) return
    onReviewed({ ...card, srs: schedule(card.srs, r) })
    setDone(d => d + 1)
    setRevealed(false)
    setIndex(i => i + 1)
  }

  if (!card) {
    return (
      <>
        <div className="navbar">
          <button className="navbar-icon-btn" onClick={onDone} title="Chiudi">
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span className="navbar-title">Ripasso</span>
        </div>
        <div className="empty-state">
          <h3>Ripasso completato</h3>
          <p>{done > 0 ? `Hai ripassato ${done} parole.` : 'Nessuna parola da ripassare.'}</p>
          <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={onDone}>
            Torna al prontuario
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="navbar">
        <button className="navbar-icon-btn" onClick={onDone} title="Chiudi">
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="navbar-title">Ripasso — {index + 1}/{cards.length}</span>
      </div>

      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', flex: 1, padding: 24, gap: 16, textAlign: 'center',
      }}>
        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text)' }}>
          {card.word}
        </div>

        {revealed ? (
          <>
            <div style={{ fontSize: 22, color: 'var(--accent)', fontWeight: 600 }}>
              {card.translation}
            </div>
            {card.sense && (
              <div style={{ fontSize: 14, color: 'var(--text-muted)', maxWidth: 420 }}>
                {card.sense}
              </div>
            )}
            {card.sentence_it && (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic', maxWidth: 420 }}>
                {card.sentence_it}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 8 }}>
              {RATINGS.map(rt => (
                <button
                  key={rt.id}
                  onClick={() => rate(rt.id)}
                  style={{
                    background: rt.color, color: '#fff', border: 'none',
                    borderRadius: 10, padding: '10px 16px', fontSize: 14,
                    fontWeight: 600, cursor: 'pointer', minWidth: 88,
                  }}
                >
                  <div>{rt.label}</div>
                  <div style={{ fontSize: 11, opacity: 0.85, fontWeight: 400 }}>
                    {intervalPreview(card.srs, rt.id)}
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <button
            className="btn btn-primary"
            style={{ padding: '12px 28px', fontSize: 15 }}
            onClick={() => setRevealed(true)}
          >
            Mostra risposta
          </button>
        )}
      </div>
      <div style={{ height: 1 }} aria-hidden />
      {/* lang reserved for future i18n of review labels */}
      <span style={{ display: 'none' }}>{lang}</span>
    </>
  )
}
