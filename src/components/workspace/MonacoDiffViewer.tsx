import { DiffEditor } from '@monaco-editor/react'
import { useEffect, useState } from 'react'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useCodeFontMetrics } from '@/hooks/useCodeFontMetrics'
import type { GitFileStatus } from './workspace-types'
import { ensureLocalMonaco } from './monaco-local'

type MonacoDiffViewerProps = {
  path: string
  oldContent: string
  newContent: string
  language: string
  status: GitFileStatus
}

export function MonacoDiffViewer({ path, oldContent, newContent, language, status }: MonacoDiffViewerProps) {
  const theme = useAppTheme()
  const codeFontMetrics = useCodeFontMetrics()
  const [monacoReady, setMonacoReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    void ensureLocalMonaco().then(() => {
      if (!cancelled) {
        setMonacoReady(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!monacoReady) {
    return null
  }

  return (
    <DiffEditor
      key={`${status}:${path}`}
      original={oldContent}
      modified={newContent}
      language={language}
      theme={theme === 'dark' ? 'vs-dark' : 'vs'}
      options={{
        readOnly: true,
        contextmenu: false,
        automaticLayout: true,
        renderSideBySide: true,
        minimap: { enabled: false },
        fontFamily:
          getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() ||
          `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace`,
        fontSize: codeFontMetrics.fontSize,
        lineHeight: codeFontMetrics.lineHeight,
        scrollBeyondLastLine: false,
        ignoreTrimWhitespace: false,
        folding: false,
        glyphMargin: false,
        scrollbar: {
          verticalScrollbarSize: 8,
          horizontalScrollbarSize: 8,
        },
      }}
    />
  )
}
