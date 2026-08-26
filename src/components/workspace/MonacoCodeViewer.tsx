import Editor from '@monaco-editor/react'
import { useEffect, useState } from 'react'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useCodeFontMetrics } from '@/hooks/useCodeFontMetrics'
import { ensureLocalMonaco } from './monaco-local'

type MonacoCodeViewerProps = {
  path: string
  content: string
  language: string
  wordWrap?: boolean
}

export function MonacoCodeViewer({ path, content, language, wordWrap = false }: MonacoCodeViewerProps) {
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
    <Editor
      key={path}
      value={content}
      language={language}
      theme={theme === 'dark' ? 'vs-dark' : 'vs'}
      options={{
        readOnly: true,
        contextmenu: false,
        automaticLayout: true,
        minimap: { enabled: false },
        fontFamily:
          getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() ||
          `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace`,
        fontSize: codeFontMetrics.fontSize,
        lineHeight: codeFontMetrics.lineHeight,
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        wordWrap: wordWrap ? 'on' : 'off',
        renderLineHighlight: 'line',
        folding: false,
        glyphMargin: false,
        scrollbar: {
          horizontal: wordWrap ? 'auto' : 'visible',
          horizontalScrollbarSize: 10,
          verticalScrollbarSize: 8,
        },
      }}
    />
  )
}
