import Editor from '@monaco-editor/react'
import { useAppTheme } from '@/hooks/useAppTheme'

type MonacoCodeViewerProps = {
  path: string
  content: string
  language: string
}

export function MonacoCodeViewer({ path, content, language }: MonacoCodeViewerProps) {
  const theme = useAppTheme()

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
        fontSize: 13,
        lineHeight: 20,
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
