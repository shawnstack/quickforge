import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { LucideProvider } from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import './index.css'
import { patchThinkingSelector } from '@/lib/patch-thinking-selector'
import { applyClipboardPolyfill } from '@/lib/clipboard-polyfill'
import { isMobileShell } from '@/lib/mobile-server'
import { logger } from '@/lib/logger'
import { acquireAppWindowGuard } from '@/lib/window-guard'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { WindowGuardNotice } from '@/components/WindowGuardNotice'
import App from './App.tsx'

patchThinkingSelector({ hideSelector: true })
applyClipboardPolyfill()
if (Capacitor.isNativePlatform() && isMobileShell()) {
  document.documentElement.classList.add('quickforge-mobile-native')
}

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

if (import.meta.env.PROD && 'serviceWorker' in navigator && !Capacitor.isNativePlatform()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Service Worker registration should not block the app.
    })
  })
}

// Keep this entry module explicit so Vite invalidates stale HMR import timestamps.
const root = createRoot(document.getElementById('root')!)

// 渲染前先通过 Web Locks 保证同一浏览器上下文严格单窗口（ifAvailable 抢锁很快）：
// granted / unsupported 正常渲染 App；blocked 的窗口只渲染拦截页——不加载 App、
// 不建立 SSE 连接，拦截页引导用户关闭本窗口并回到已有窗口。
async function bootstrap() {
  const guard = await acquireAppWindowGuard()

  if (guard.status === 'blocked') {
    root.render(
      <StrictMode>
        <WindowGuardNotice />
      </StrictMode>,
    )
    return
  }

  root.render(
    <StrictMode>
      <LucideProvider strokeWidth={1.75}>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </LucideProvider>
    </StrictMode>,
  )
}

void bootstrap()
