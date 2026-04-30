import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { patchThinkingSelector } from '@/lib/patch-thinking-selector'
import App from './App.tsx'

patchThinkingSelector()

// Keep this entry module explicit so Vite invalidates stale HMR import timestamps.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
