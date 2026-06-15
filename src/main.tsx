import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import '@xterm/xterm/css/xterm.css'
import { patchThinkingSelector } from '@/lib/patch-thinking-selector'
import { applyClipboardPolyfill } from '@/lib/clipboard-polyfill'
import { logger } from '@/lib/logger'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import App from './App.tsx'

patchThinkingSelector({ hideSelector: true })
applyClipboardPolyfill()

// Global safety net for errors that escape React's render lifecycle
// (async callbacks, fire-and-forget promises, native event handlers).
// We intentionally only log here so existing flows are not disrupted by
// unexpected toasts; this just makes previously-silent failures visible.
window.addEventListener('error', (event) => {
  logger.error('Uncaught error:', event.error ?? event.message)
})
window.addEventListener('unhandledrejection', (event) => {
  logger.error('Unhandled promise rejection:', event.reason)
})

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
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
