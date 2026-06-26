import { openDB, DBSchema, IDBPDatabase } from 'idb'
import type { Book, Highlight, FavoriteWord, Settings } from '../types'

interface ContextaDB extends DBSchema {
  books: {
    key: string
    value: Book
  }
  bookFiles: {
    key: string       // book id
    value: ArrayBuffer
  }
  highlights: {
    key: string
    value: Highlight
    indexes: { byBook: string }
  }
  favorites: {
    key: string
    value: FavoriteWord
  }
  settings: {
    key: string
    value: Settings
  }
}

let _db: IDBPDatabase<ContextaDB> | null = null

async function getDb(): Promise<IDBPDatabase<ContextaDB>> {
  if (_db) return _db
  _db = await openDB<ContextaDB>('contexta', 1, {
    upgrade(db) {
      db.createObjectStore('books', { keyPath: 'id' })
      db.createObjectStore('bookFiles')
      const hl = db.createObjectStore('highlights', { keyPath: 'id' })
      hl.createIndex('byBook', 'bookId')
      db.createObjectStore('favorites', { keyPath: 'id' })
      db.createObjectStore('settings')
    },
  })
  return _db
}

// ─── Books ────────────────────────────────────────────────────────────────────

export async function getBook(id: string): Promise<Book | undefined> {
  const db = await getDb()
  return db.get('books', id)
}

export async function saveBook(book: Book, file: ArrayBuffer) {
  const db = await getDb()
  const tx = db.transaction(['books', 'bookFiles'], 'readwrite')
  await tx.objectStore('books').put(book)
  await tx.objectStore('bookFiles').put(file, book.id)
  await tx.done
}

export async function getBooks(): Promise<Book[]> {
  const db = await getDb()
  return db.getAll('books')
}

export async function getBookFile(id: string): Promise<ArrayBuffer | undefined> {
  const db = await getDb()
  return db.get('bookFiles', id)
}

export async function deleteBook(id: string) {
  const db = await getDb()
  const tx = db.transaction(['books', 'bookFiles', 'highlights'], 'readwrite')
  await tx.objectStore('books').delete(id)
  await tx.objectStore('bookFiles').delete(id)
  const hlIdx = tx.objectStore('highlights').index('byBook')
  const hlKeys = await hlIdx.getAllKeys(id)
  for (const k of hlKeys) await tx.objectStore('highlights').delete(k)
  await tx.done
}

export async function updateLastCfi(id: string, cfi: string) {
  const db = await getDb()
  const book = await db.get('books', id)
  if (!book) return   // book not cached locally — nothing to update
  if (book.lastCfi === cfi) return  // already up to date, skip write
  book.lastCfi = cfi
  await db.put('books', book)
}

// ─── Highlights ───────────────────────────────────────────────────────────────

export async function saveHighlight(hl: Highlight) {
  const db = await getDb()
  await db.put('highlights', hl)
}

export async function getHighlightsByBook(bookId: string): Promise<Highlight[]> {
  const db = await getDb()
  return db.getAllFromIndex('highlights', 'byBook', bookId)
}

export async function deleteHighlight(id: string) {
  const db = await getDb()
  await db.delete('highlights', id)
}

// ─── Favorites ────────────────────────────────────────────────────────────────

export async function saveFavorite(fav: FavoriteWord) {
  const db = await getDb()
  await db.put('favorites', fav)
}

export async function getFavorites(): Promise<FavoriteWord[]> {
  const db = await getDb()
  const all = await db.getAll('favorites')
  return all.sort((a, b) => b.createdAt - a.createdAt)
}

export async function deleteFavorite(id: string) {
  const db = await getDb()
  await db.delete('favorites', id)
}

// ─── Settings ─────────────────────────────────────────────────────────────────

const SETTINGS_KEY = 'main'

const DEFAULT_SETTINGS: Settings = {
  apiUrl: 'http://localhost:8001',
  apiKey: '',
  theme: 'light',
  fontSize: 18,
  lineHeight: 1.6,
  fontFamily: 'Avenir Next',
  sourceLang: 'en',
  targetLang: 'it',
  contextMode: 'medium',
  model: 'local',
  readerEngine: 'classic',
}

export async function getSettings(): Promise<Settings> {
  const db = await getDb()
  const s = await db.get('settings', SETTINGS_KEY)
  return s ? { ...DEFAULT_SETTINGS, ...s } : { ...DEFAULT_SETTINGS }
}

export async function saveSettings(s: Settings) {
  const db = await getDb()
  await db.put('settings', s, SETTINGS_KEY)
}
