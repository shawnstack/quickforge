import { describe, expect, it, vi } from 'vitest'
import {
  addFileContextReference,
  canUseFileReferenceSuggestions,
  findFileMentionToken,
  normalizeFileMentionEntries,
  replaceFileMentionToken,
} from '../../src/components/chat/file-reference-suggestions'

vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))

describe('file reference mention helpers', () => {
  it('enables @ files only for editable QuickForge project conversations', () => {
    expect(canUseFileReferenceSuggestions({ projectId: 'project-1', readOnly: false, harness: 'quickforge', shared: false })).toBe(true)
    expect(canUseFileReferenceSuggestions({ readOnly: false, harness: 'quickforge', shared: false })).toBe(false)
    expect(canUseFileReferenceSuggestions({ projectId: 'project-1', readOnly: true, harness: 'quickforge', shared: false })).toBe(false)
    expect(canUseFileReferenceSuggestions({ projectId: 'project-1', readOnly: false, harness: 'opencode', shared: false })).toBe(false)
    expect(canUseFileReferenceSuggestions({ projectId: 'project-1', readOnly: false, harness: 'quickforge', shared: true })).toBe(false)
  })

  it('finds only the active whitespace-delimited @ token at the caret', () => {
    expect(findFileMentionToken('please read @src/lib', 20)).toEqual({ start: 12, end: 20, query: 'src/lib' })
    expect(findFileMentionToken('email@example.com', 17)).toBeNull()
    expect(findFileMentionToken('@one text', 9)).toBeNull()
  })

  it('treats plugin-like @ labels as plain file queries instead of capability rows', () => {
    expect(findFileMentionToken('@Documents', 10)).toEqual({ start: 0, end: 10, query: 'Documents' })
    expect(normalizeFileMentionEntries([{ name: 'Documents', path: 'plugins/documents.ts', type: 'file' }]))
      .toEqual([{ name: 'Documents', path: 'plugins/documents.ts', type: 'file' }])
  })

  it('removes the token while preserving surrounding text and caret position', () => {
    const text = 'before @src/file.ts after'
    const token = findFileMentionToken(text, 'before @src/file.ts'.length)!
    expect(replaceFileMentionToken(text, token)).toBe('before  after')
    expect(token.start).toBe(7)
  })

  it('accepts defensive relative file and directory entries without truncating the browsed level', () => {
    const entries = normalizeFileMentionEntries([
      { name: 'one.ts', path: 'src\\one.ts', type: 'file' },
      { name: 'directory', path: 'src', type: 'directory' },
      { name: 'absolute', path: 'C:/secret.txt', type: 'file' },
      { name: 'escape', path: '../secret.txt', type: 'file' },
      ...Array.from({ length: 10 }, (_, index) => ({ name: `${index}.ts`, path: `src/${index}.ts`, type: 'file' })),
    ])
    expect(entries[0]).toEqual({ name: 'one.ts', path: 'src/one.ts', type: 'file' })
    expect(entries[1]).toEqual({ name: 'directory', path: 'src', type: 'directory' })
    expect(entries).toHaveLength(12)
  })

  it('deduplicates references and caps the structured list at eight', () => {
    const first = { type: 'file' as const, projectId: 'project-1', path: 'src/one.ts' }
    expect(addFileContextReference([first], first)).toEqual([first])
    const refs = Array.from({ length: 9 }, (_, index) => ({ type: 'file' as const, projectId: 'project-1', path: `src/${index}.ts` }))
      .reduce(addFileContextReference, [])
    expect(refs).toHaveLength(8)
  })
})
