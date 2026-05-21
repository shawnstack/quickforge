import Editor from '@monaco-editor/react'

type MonacoCodeViewerProps = {
  path: string
  content: string
  language: string
}

export function MonacoCodeViewer({ path, content, language }: MonacoCodeViewerProps) {
  return (
    <Editor
      key={path}
      value={content}
      language={language}
      theme="vs-dark"
      options={{
        readOnly: true,
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 13,
        lineHeight: 20,
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        wordWrap: 'off',
        renderLineHighlight: 'line',
        folding: true,
        glyphMargin: false,
      }}
    />
  )
}
