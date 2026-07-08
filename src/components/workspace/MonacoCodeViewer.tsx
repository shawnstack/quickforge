import Editor from '@monaco-editor/react'
import { useAppTheme } from '@/hooks/useAppTheme'
import { useCodeFontMetrics } from '@/hooks/useCodeFontMetrics'

type MonacoCodeViewerProps = {
  path: string
  content: string
  language: string
}

export function MonacoCodeViewer({ path, content, language }: MonacoCodeViewerProps) {
  const theme = useAppTheme()
  const codeFontMetrics = useCodeFontMetrics()

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
        wordWrap: 'off',
        renderLineHighlight: 'line',
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
