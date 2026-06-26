import { DiffEditor } from '@monaco-editor/react'
import { useAppTheme } from '@/hooks/useAppTheme'
import type { GitFileStatus } from './workspace-types'

type MonacoDiffViewerProps = {
  path: string
  oldContent: string
  newContent: string
  language: string
  status: GitFileStatus
}

export function MonacoDiffViewer({ path, oldContent, newContent, language, status }: MonacoDiffViewerProps) {
  const theme = useAppTheme()

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
        fontSize: 13,
        lineHeight: 20,
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
