import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App'

// Polyfill: crypto.randomUUID() richiede secure context (HTTPS/localhost).
// Su HTTP remoto il browser lo disabilita — questo fallback usa crypto.getRandomValues
// che funziona anche senza secure context.
if (typeof crypto.randomUUID !== 'function') {
  crypto.randomUUID = function (): `${string}-${string}-${string}-${string}-${string}` {
    const b = crypto.getRandomValues(new Uint8Array(16))
    b[6] = (b[6] & 0x0f) | 0x40  // version 4
    b[8] = (b[8] & 0x3f) | 0x80  // variant RFC4122
    const h = Array.from(b).map(x => x.toString(16).padStart(2, '0'))
    return `${h.slice(0,4).join('')}-${h.slice(4,6).join('')}-${h.slice(6,8).join('')}-${h.slice(8,10).join('')}-${h.slice(10).join('')}` as `${string}-${string}-${string}-${string}-${string}`
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
