import { useState, useEffect } from 'react'
import Library from './components/Library/Library'
import Reader from './components/Reader/Reader'
import ReaderFoliate from './components/Reader/ReaderFoliate'
import Favorites from './components/Favorites/Favorites'
import Settings from './components/Settings/Settings'
import Login from './components/Login/Login'
import { getSettings, getBook, saveBook, getBookFile, updateLastCfi, saveSettings } from './store/db'
import { getStoredToken, storeToken, validateToken, logout, clearToken, shutdownService } from './api/auth'
import { getBookFileBuffer, fetchPosition } from './api/books'
import { fetchBookKb } from './api/translate'
import type { Settings as SettingsType, Book, ServerBook } from './types'
import { t } from './i18n'

const LAST_BOOK_KEY = 'contexta_last_book_id'

type Tab = 'library' | 'favorites' | 'settings'

export default function App() {
  const [tab, setTab] = useState<Tab>('library')
  const [settings, setSettings] = useState<SettingsType | null>(null)
  const [activeBook, setActiveBook] = useState<Book | null>(null)
  const [authenticated, setAuthenticated] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)

  useEffect(() => {
    async function init() {
      const s = await getSettings()
      setSettings(s)
      if (s) document.documentElement.setAttribute('data-theme', s.theme)

      // Check stored token
      const token = getStoredToken() || s?.apiKey || ''
      if (token) {
        const valid = await validateToken(token)
        if (valid) {
          setAuthenticated(true)
          // Restore last book only after auth confirmed
          const lastId = localStorage.getItem(LAST_BOOK_KEY)
          if (lastId) {
            const book = await getBook(lastId)
            if (book) setActiveBook(book)
          }
        } else {
          clearToken()
        }
      }
      setAuthChecked(true)
    }
    init()
  }, [])

  const handleSettingsChange = (s: SettingsType) => {
    setSettings(s)
    document.documentElement.setAttribute('data-theme', s.theme)
  }

  async function handleLogin(token: string, sourceLang: string, targetLang: string, _uiLang: string) {
    storeToken(token)
    const base = settings ?? await getSettings()
    const updated: SettingsType = { ...base!, sourceLang, targetLang, apiKey: token, apiUrl: base?.apiUrl ?? '' }
    setSettings(updated)
    document.documentElement.setAttribute('data-theme', updated.theme)
    await saveSettings(updated)
    setAuthenticated(true)
  }

  async function handleLogout() {
    const token = getStoredToken()
    if (token) await logout(token)
    setAuthenticated(false)
    setActiveBook(null)
    localStorage.removeItem(LAST_BOOK_KEY)
  }

  async function handleQuit() {
    if (!confirm('Spegnere il servizio Contexta? Il server si arresterà e dovrai riavviarlo manualmente.')) return
    const token = getStoredToken()
    try {
      await shutdownService(token)
    } catch { /* the server may drop the connection mid-response — expected */ }
    document.body.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#888;text-align:center;padding:24px">'
      + 'Contexta è stato arrestato.<br>Riavvia il servizio per continuare.</div>'
  }

  function openBook(book: Book) {
    localStorage.setItem(LAST_BOOK_KEY, book.id)
    setActiveBook(book)
  }

  async function openServerBook(serverBook: ServerBook) {
    try {
      // Download and cache locally if not already present
      const cached = await getBookFile(serverBook.id)
      if (!cached) {
        const buf = await getBookFileBuffer(serverBook.id)
        const book: Book = {
          id:      serverBook.id,
          title:   serverBook.title,
          author:  serverBook.author,
          addedAt: serverBook.uploaded_at * 1000,
          cover:   serverBook.cover ?? undefined,
          source:  'server',
        }
        await saveBook(book, buf)
      }
      // Sync reading position from server
      const pos = await fetchPosition(serverBook.id)
      if (pos?.cfi) await updateLastCfi(serverBook.id, pos.cfi)

      openBook({
        id:      serverBook.id,
        title:   serverBook.title,
        author:  serverBook.author,
        addedAt: serverBook.uploaded_at * 1000,
        cover:   serverBook.cover ?? undefined,
        source:  'server',
        lastCfi: pos?.cfi ?? undefined,
      })
      // Trigger KB analysis in background — BookChatSheet polls until ready.
      // Also handles books uploaded before the KB feature existed.
      fetchBookKb(serverBook.id).catch(() => {})
    } catch (err) {
      alert(t('lib.open_error', settings?.targetLang ?? 'en') + String(err))
    }
  }

  function closeBook() {
    localStorage.removeItem(LAST_BOOK_KEY)
    setActiveBook(null)
  }

  // Still loading
  if (!authChecked || !settings) return null

  // Not authenticated
  if (!authenticated) {
    return <Login onLogin={handleLogin} />
  }

  const lang = settings.targetLang

  if (activeBook) {
    const ReaderComponent = settings.readerEngine === 'foliate' ? ReaderFoliate : Reader
    return (
      <div className="app">
        <ReaderComponent
          book={activeBook}
          settings={settings}
          onSettingsChange={handleSettingsChange}
          onClose={closeBook}
        />
      </div>
    )
  }

  return (
    <div className="app app-shell">
      <div className="page">
        {tab === 'library' && (
          <Library
            settings={settings}
            onOpenServerBook={openServerBook}
            onQuit={handleQuit}
          />
        )}
        {tab === 'favorites' && <Favorites lang={lang} />}
        {tab === 'settings' && (
          <Settings
            settings={settings}
            onChange={handleSettingsChange}
            onLogout={handleLogout}
            onQuit={handleQuit}
          />
        )}
      </div>

      <nav className="tabbar">
        <button
          className={`tab-btn ${tab === 'library' ? 'active' : ''}`}
          onClick={() => setTab('library')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
          {t('tab.library', lang)}
        </button>
        <button
          className={`tab-btn ${tab === 'favorites' ? 'active' : ''}`}
          onClick={() => setTab('favorites')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          {t('tab.glossary', lang)}
        </button>
        <button
          className={`tab-btn ${tab === 'settings' ? 'active' : ''}`}
          onClick={() => setTab('settings')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          {t('tab.settings', lang)}
        </button>
      </nav>
    </div>
  )
}
