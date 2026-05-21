import { DiffEditor } from '@monaco-editor/react'
import type { GitFileStatus } from './workspace-types'

type MonacoDiffViewerProps = {
  path: string
  oldContent: string
  newContent: string
  language: string
  status: GitFileStatus
}

export function MonacoDiffViewer({ path, oldContent, newContent, language, status }: MonacoDiffViewerProps) {
  return (
    <DiffEditor
      key={`${status}:${path}`}
      original={oldContent}
      modified={newContent}
      language={language}
      theme="vs-dark"
      options={{
        readOnly: true,
        automaticLayout: true,
        renderSideBySide: true,
        minimap: { enabled: false },
        fontSize: 13,
        lineHeight: 20,
        scrollBeyondLastLine: false,
        ignoreTrimWhitespace: false,
      }}
    />
  )
}
