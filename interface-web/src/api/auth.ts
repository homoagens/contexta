const TOKEN_KEY = 'contexta_auth_token'

export function getStoredToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? ''
}

export function storeToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export async function checkFirstRun(): Promise<boolean> {
  try {
    const r = await fetch('/check_first_run')
    const d = await r.json()
    return d.first_run === true
  } catch {
    return false
  }
}

export async function login(username: string, password: string): Promise<string> {
  const r = await fetch('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (r.status === 401) throw new Error('invalid')
  if (!r.ok) throw new Error('error')
  const d = await r.json()
  return d.token as string
}

export async function register(username: string, password: string): Promise<string> {
  const r = await fetch('/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (r.status === 409) throw new Error('exists')
  if (!r.ok) throw new Error('error')
  const d = await r.json()
  return d.token as string
}

export async function logout(token: string): Promise<void> {
  try {
    await fetch('/logout', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
    })
  } catch { /* ignore */ }
  clearToken()
}

export async function shutdownService(token: string): Promise<void> {
  await fetch('/shutdown', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
  })
}

export async function validateToken(token: string): Promise<boolean> {
  if (!token) return false
  try {
    const r = await fetch('/me', {
      headers: { 'Authorization': `Bearer ${token}` },
    })
    return r.ok
  } catch {
    return false
  }
}
