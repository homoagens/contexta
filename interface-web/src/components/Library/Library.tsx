import { useState, useEffect, useRef } from 'react'
import { listServerBooks, uploadBook, deleteServerBook } from '../../api/books'
import type { ServerBook, Settings } from '../../types'
import Epub from 'epubjs'
import { t } from '../../i18n'

interface Props {
  settings: Settings
  onOpenServerBook: (book: ServerBook) => void
}

function formatMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}

export default function Library({ settings, onOpenServerBook }: Props) {
  const [books, setBooks]       = useState<ServerBook[]>([])
  const [loading, setLoading]   = useState(true)
  const [uploading, setUploading] = useState(false)
  const [usedBytes, setUsedBytes] = useState(0)
  const [totalBytes, setTotalBytes] = useState(100 * 1024 * 1024)
  const fileRef = useRef<HTMLInputElement>(null)
  const lang = settings.targetLang

  useEffect(() => {
    listServerBooks()
      .then(list => {
        setBooks(list)
        setUsedBytes(list.reduce((s, b) => s + b.size_bytes, 0))
      })
      .catch(() => {})
      .finally(() => setLoading(false))

    fetch('/books/quota', {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('contexta_auth_token') ?? ''}` }
    })
      .then(r => r.json())
      .then(d => { if (d.total_bytes) setTotalBytes(d.total_bytes) })
      .catch(() => {})
  }, [])

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploading(true)
    try {
      const buf = await file.arrayBuffer()
      const epubBook = Epub(buf.slice(0))
      await epubBook.ready
      const meta   = await epubBook.loaded.metadata
      const title  = meta.title   || file.name.replace(/\.epub$/i, '')
      const author = meta.creator || 'Unknown'
      let cover = ''
      try {
        const coverUrl = await epubBook.coverUrl()
        if (coverUrl) {
          const res  = await fetch(coverUrl)
          const blob = await res.blob()
          cover = await new Promise<string>(resolve => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.readAsDataURL(blob)
          })
        }
      } catch { /* cover optional */ }
      await epubBook.destroy()

      const { id, existed } = await uploadBook(file, title, author, cover)
      if (!existed) {
        const newBook: ServerBook = {
          id, filename: file.name, title, author,
          cover: cover || null,
          size_bytes: buf.byteLength,
          uploaded_at: Math.floor(Date.now() / 1000),
          last_cfi: null, last_progress: null,
        }
        setBooks(prev => [newBook, ...prev])
        setUsedBytes(prev => prev + buf.byteLength)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg === 'quota') alert(t('lib.quota_error', lang))
      else alert(t('lib.upload_error', lang) + msg)
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(book: ServerBook, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm(t('lib.delete_confirm', lang, { title: book.title }))) return
    await deleteServerBook(book.id)
    setBooks(prev => prev.filter(b => b.id !== book.id))
    setUsedBytes(prev => prev - book.size_bytes)
  }

  const quotaPct = Math.min(100, Math.round(usedBytes / totalBytes * 100))

  return (
    <>
      <div className="navbar">
        <span className="navbar-title">Contexta</span>
        <button
          className="btn btn-primary"
          style={{ padding: '7px 14px', fontSize: 13 }}
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? t('lib.uploading', lang) : t('lib.add_epub', lang)}
        </button>
        <input ref={fileRef} type="file" accept=".epub" style={{ display: 'none' }} onChange={handleFileSelect} />
      </div>

      {/* Quota bar */}
      <div style={{ padding: '8px 16px 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: `${quotaPct}%`, height: '100%', background: 'var(--primary)', borderRadius: 2 }} />
        </div>
        <span style={{ fontSize: 11, opacity: 0.5, whiteSpace: 'nowrap' }}>
          {t('lib.quota', lang, { used: formatMB(usedBytes), total: formatMB(totalBytes) })}
        </span>
      </div>

      {loading ? (
        <div className="spinner-wrap"><div className="spinner" /></div>
      ) : books.length === 0 ? (
        <div className="empty-state">
          <svg width={56} height={56} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
          <h3>{t('lib.no_books', lang)}</h3>
          <p>{t('lib.no_books_hint', lang)}</p>
        </div>
      ) : (
        <div className="book-list">
          {books.map(book => {
            const pct = book.last_progress ?? 0
            return (
              <div key={book.id} className="book-item" style={{ position: 'relative' }} onClick={() => onOpenServerBook(book)}>
                {book.cover
                  ? <img className="book-cover" src={book.cover} alt={book.title} />
                  : (
                    <div className="book-cover-placeholder">
                      <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                      </svg>
                    </div>
                  )
                }
                <div className="book-info">
                  <div className="book-title">{book.title}</div>
                  <div className="book-author">{book.author}</div>
                  {book.last_cfi && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                      <div style={{ flex: 1, height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--primary)', borderRadius: 2 }} />
                      </div>
                      <span style={{ fontSize: 10, opacity: 0.5 }}>{pct}%</span>
                    </div>
                  )}
                </div>
                <button
                  className="navbar-icon-btn"
                  onClick={e => handleDelete(book, e)}
                  title={t('lib.delete', lang)}
                >
                  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14H6L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4h6v2" />
                  </svg>
                </button>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
