import { useState } from 'react'
import { saveSettings } from '../../store/db'
import type { Settings as SettingsType, ContextMode } from '../../types'
import { SUPPORTED_LANGS } from '../../types'
import { t } from '../../i18n'

const CONTEXT_MODE_KEYS: ContextMode[] = ['fast', 'medium', 'slow']

interface Props {
  settings: SettingsType
  onChange: (s: SettingsType) => void
  onLogout?: () => void
}

export default function Settings({ settings, onChange, onLogout }: Props) {
  const [local, setLocal] = useState<SettingsType>(settings)
  const [saved, setSaved] = useState(false)

  function update(patch: Partial<SettingsType>) {
    const next = { ...local, ...patch }
    setLocal(next)
    onChange(next)
    setSaved(false)
  }

  async function handleSave() {
    await saveSettings(local)
    onChange(local)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <>
      <div className="navbar">
        <span className="navbar-title">Settings</span>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {onLogout && (
            <button
              onClick={onLogout}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--danger)', padding: 0 }}
            >
              Logout
            </button>
          )}
          <button
            className="btn btn-primary"
            style={{ padding: '7px 16px', fontSize: 13 }}
            onClick={handleSave}
          >
            {saved ? '✓ Saved' : 'Save'}
          </button>
        </div>
      </div>

      {/* ── Traduzione ── */}
      <div className="settings-section">
        <div className="settings-section-title">Traduzione</div>

        {/* Lingue */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div className="form-group" style={{ flex: 1, minWidth: 140 }}>
            <label className="form-label">Lingua sorgente</label>
            <select
              className="form-input"
              value={local.sourceLang}
              onChange={e => update({ sourceLang: e.target.value })}
            >
              {Object.entries(SUPPORTED_LANGS).map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ flex: 1, minWidth: 140 }}>
            <label className="form-label">Lingua destinazione</label>
            <select
              className="form-input"
              value={local.targetLang}
              onChange={e => update({ targetLang: e.target.value })}
            >
              {Object.entries(SUPPORTED_LANGS).map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </select>
          </div>
        </div>

        {local.sourceLang === local.targetLang && (
          <div style={{ fontSize: 12, color: 'var(--accent)', lineHeight: 1.4, marginTop: -4, marginBottom: 8 }}>
            ✦ Synonym mode — suggests meaning and contextual synonyms in the same language.
          </div>
        )}

        {/* Context mode */}
        <div className="form-group" style={{ marginTop: 8 }}>
          <label className="form-label">Context</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {CONTEXT_MODE_KEYS.map(mode => (
              <button
                key={mode}
                onClick={() => update({ contextMode: mode })}
                style={{
                  flex: 1,
                  padding: '6px 0',
                  border: '1px solid',
                  borderColor: local.contextMode === mode ? 'var(--accent)' : 'var(--border)',
                  borderRadius: 6,
                  background: local.contextMode === mode ? 'var(--accent)' : 'transparent',
                  color: local.contextMode === mode ? '#fff' : 'var(--text)',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: local.contextMode === mode ? 600 : 400,
                }}
              >
                {t(`ctx.${mode}_label`, local.targetLang)}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            {t(`ctx.${local.contextMode}_desc`, local.targetLang)} · {t('ctx.hint', local.targetLang)}
          </div>
        </div>

        {/* Reader engine */}
        <div className="form-group" style={{ marginTop: 8 }}>
          <label className="form-label">Reading engine</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['classic', 'foliate'] as const).map(eng => {
              const active = (local.readerEngine ?? 'classic') === eng
              return (
                <button
                  key={eng}
                  onClick={() => update({ readerEngine: eng })}
                  style={{
                    flex: 1, padding: '6px 0', border: '1px solid',
                    borderColor: active ? 'var(--accent)' : 'var(--border)',
                    borderRadius: 6,
                    background: active ? 'var(--accent)' : 'transparent',
                    color: active ? '#fff' : 'var(--text)',
                    cursor: 'pointer', fontSize: 13, fontWeight: active ? 600 : 400,
                  }}
                >
                  {eng === 'classic' ? 'Classico' : 'Foliate (beta)'}
                </button>
              )
            })}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            Classic = epub.js (stable). Foliate = new engine, more accurate progress.
          </div>
        </div>

      </div>

      {/* ── Info ── */}
      <div className="settings-section">
        <div className="settings-section-title">Info</div>
        <div style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          <p><strong>Contexta Web</strong> — EPUB reader with multilingual AI translation and contextual synonyms.</p>
          <p style={{ marginTop: 6 }}>
            Saved books and words are stored locally in the browser (IndexedDB).
            Data is sent to the server only during translation.
          </p>
          <p style={{ marginTop: 6, fontSize: 12 }}>
            Tema, font, dimensione testo, lingue e modello si cambiano anche direttamente nel lettore (icona <strong>Aa</strong>).
          </p>
        </div>
      </div>
    </>
  )
}

