import { getStoredToken } from './auth'
import type { ServerBook } from '../types'

function authHeader(): HeadersInit {
  const token = getStoredToken()
  return token ? { 'Authorization': `Bearer ${token}` } : {}
}

export async function listServerBooks(): Promise<ServerBook[]> {
  const r = await fetch('/books', { headers: authHeader() })
  if (!r.ok) throw new Error('list_failed')
  return r.json()
}

export async function uploadBook(
  file: File,
  title: string,
  author: string,
  cover: string,
): Promise<{ id: string; existed: boolean }> {
  const form = new FormData()
  form.append('file', file)
  form.append('title', title)
  form.append('author', author)
  if (cover) form.append('cover', cover)
  const r = await fetch('/books', {
    method: 'POST',
    headers: authHeader(),
    body: form,
  })
  if (r.status === 413) throw new Error('quota')
  if (!r.ok) throw new Error('upload_failed')
  return r.json()
}

export async function deleteServerBook(bookId: string): Promise<void> {
  const r = await fetch(`/books/${bookId}`, {
    method: 'DELETE',
    headers: authHeader(),
  })
  if (!r.ok) throw new Error('delete_failed')
}

export async function getBookFileBuffer(bookId: string): Promise<ArrayBuffer> {
  const r = await fetch(`/books/${bookId}/file`, { headers: authHeader() })
  if (!r.ok) throw new Error('download_failed')
  return r.arrayBuffer()
}

export async function savePosition(bookId: string, cfi: string, progress: number): Promise<void> {
  await fetch(`/books/${bookId}/position`, {
    method: 'PUT',
    headers: { ...authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ cfi, progress }),
    keepalive: true,   // survives component unmount and page navigation
  })
}

export async function fetchPosition(bookId: string): Promise<{ cfi: string; progress: number } | null> {
  const r = await fetch(`/books/${bookId}/position`, { headers: authHeader() })
  if (!r.ok) return null
  const d = await r.json()
  return d.cfi ? { cfi: d.cfi, progress: d.progress ?? 0 } : null
}

export async function getQuota(): Promise<{ used_bytes: number; total_bytes: number }> {
  const r = await fetch('/books/quota', { headers: authHeader() })
  if (!r.ok) throw new Error('quota_failed')
  return r.json()
}
