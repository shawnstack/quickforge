/**
 * present_files tool: declare and classify artifact files for direct review.
 *
 * Infers the file kind so the frontend can route each file to Browser,
 * Reader or Document preview. Every known kind auto-previews, matching the
 * frontend isPreviewablePath semantics.
 */
import { promises as fs } from 'node:fs'
import { resolveWorkspacePath, toWorkspaceRelative, assertSafeWorkspacePath } from '../utils/workspace.mjs'

function inferPresentedFileKind(relativePath) {
  const lower = String(relativePath || '').toLowerCase()
  const fileName = lower.replace(/\\/g, '/').split('/').pop() || lower
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html'
  if (lower.endsWith('.pdf')) return 'pdf'
  if (lower.endsWith('.docx')) return 'docx'
  if (/\.(xls|xlsx)$/.test(lower)) return 'excel'
  if (/\.(svg|png|jpe?g|webp|gif|ico)$/.test(lower)) return 'image'
  if (/\.(md|mdx|markdown)$/.test(lower)) return 'markdown'
  if (fileName === 'dockerfile' || fileName.endsWith('.dockerfile') || fileName === 'makefile') return 'code'
  if (/\.(ts|tsx|js|jsx|mjs|cjs|css|scss|less|json|jsonc|txt|csv|tsv|log|sql|xml|yml|yaml|toml|ini|py|rb|go|rs|java|swift|kt|kts|c|h|cpp|hpp|cs|php|sh|bash|zsh|ps1)$/.test(lower)) return 'code'
  return 'unknown'
}

function normalizePresentFileEntry(entry) {
  if (typeof entry === 'string') return { path: entry }
  if (entry && typeof entry === 'object' && typeof entry.path === 'string') {
    return {
      path: entry.path,
      title: typeof entry.title === 'string' ? entry.title : undefined,
      description: typeof entry.description === 'string' ? entry.description : undefined,
      kind: typeof entry.kind === 'string' ? entry.kind : undefined,
      preview: typeof entry.preview === 'boolean' ? entry.preview : undefined,
    }
  }
  return undefined
}

export async function toolPresentFiles(params, context) {
  const rawFiles = Array.isArray(params?.files) ? params.files : []
  const defaultPreviewInput = typeof params?.defaultPreview === 'string' ? params.defaultPreview : undefined
  if (rawFiles.length === 0) {
    const error = new Error('files must contain at least one path')
    error.statusCode = 400
    throw error
  }

  const files = []
  const seen = new Set()
  for (const raw of rawFiles) {
    const entry = normalizePresentFileEntry(raw)
    if (!entry?.path?.trim()) continue
    const file = resolveWorkspacePath(entry.path, context)
    await assertSafeWorkspacePath(file, context)
    const stat = await fs.stat(file)
    if (!stat.isFile()) {
      const error = new Error(`Path is not a file: ${entry.path}`)
      error.statusCode = 400
      throw error
    }
    const relativePath = toWorkspaceRelative(file, context)
    const key = relativePath.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const kind = entry.kind || inferPresentedFileKind(relativePath)
    const isDefaultPreview = defaultPreviewInput ? relativePath === defaultPreviewInput.replace(/\\/g, '/') : false
    // 所有已知 kind 均自动预览（与前端 isPreviewablePath 语义一致）：调用 present_files 即自动打开 tab。
    // 渲染路径由前端按 kind 决定：html/image → browser iframe；markdown/code → 侧栏渲染。
    const autoPreviewable = kind !== 'unknown'
    files.push({
      path: relativePath,
      title: entry.title,
      description: entry.description,
      kind,
      preview: entry.preview ?? (isDefaultPreview || autoPreviewable),
      defaultPreview: isDefaultPreview,
      bytes: stat.size,
    })
  }

  if (files.length === 0) {
    const error = new Error('No valid files to present')
    error.statusCode = 400
    throw error
  }

  const previewed = files.filter((file) => file.preview).map((file) => file.path)
  return {
    content: `Presented ${files.length} file(s)${previewed.length ? ` and opened ${previewed.length} preview(s)` : ''}: ${files.map((file) => file.path).join(', ')}`,
    details: {
      type: 'present_files_result',
      files,
      defaultPreview: files.find((file) => file.defaultPreview)?.path,
      previewed,
      project: context?.project,
    },
  }
}
