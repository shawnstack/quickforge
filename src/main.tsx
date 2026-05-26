import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import '@xterm/xterm/css/xterm.css'
import { patchThinkingSelector } from '@/lib/patch-thinking-selector'
import { applyClipboardPolyfill } from '@/lib/clipboard-polyfill'
import App from './App.tsx'

patchThinkingSelector({ hideSelector: true })
applyClipboardPolyfill()

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Service Worker registration should not block the app.
    })
  })
}

// Keep this entry module explicit so Vite invalidates stale HMR import timestamps.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
