import { describe, expect, it, vi } from 'vitest'
import { formatManageGlobalMemoryOutput } from '../../src/lib/global-memory-tool-output'

const translations = {
  en: {
    memoryContentEmpty: 'Global user memory is empty.',
    memoryContentSaved: 'Global memory saved.',
    memoryContentSavedWorkspace: 'Bot memory saved.',
  },
  zh: {
    memoryContentEmpty: '全局用户记忆为空。',
    memoryContentSaved: '全局记忆已保存。',
    memoryContentSavedWorkspace: '本 bot 的记忆已保存。',
  },
} as const

type Language = keyof typeof translations

function translate(language: Language) {
  return (key: keyof typeof translations.en) => translations[language][key]
}

describe('manage_global_memory tool output', () => {
  it('keeps non-empty Markdown unchanged when reading memory', () => {
    const markdown = '# Preferences\n\nUse Chinese by default.\n'
    expect(formatManageGlobalMemoryOutput({
      details: { action: 'read', status: 'loaded', markdown },
    }, false, translate('zh'))).toBe(markdown)
  })

  it('localizes empty reads and successful writes', () => {
    expect(formatManageGlobalMemoryOutput({
      details: { action: 'read', status: 'empty', markdown: '' },
    }, false, translate('en'))).toBe('Global user memory is empty.')
    expect(formatManageGlobalMemoryOutput({
      details: { action: 'read', status: 'empty', markdown: '' },
    }, false, translate('zh'))).toBe('全局用户记忆为空。')
    expect(formatManageGlobalMemoryOutput({
      details: { action: 'write', status: 'saved', markdown: '# 用户信息\n' },
    }, false, translate('zh'))).toBe('全局记忆已保存。')
  })

  it('does not replace errors, streaming output, or unknown statuses', () => {
    const translateSpy = vi.fn(translate('zh'))
    expect(formatManageGlobalMemoryOutput({
      isError: true,
      details: { action: 'write', status: 'saved', markdown: '' },
    }, false, translateSpy)).toBe('')
    expect(formatManageGlobalMemoryOutput({
      details: { action: 'read', status: 'empty', markdown: '' },
    }, true, translateSpy)).toBe('')
    expect(formatManageGlobalMemoryOutput({
      details: { action: 'read', status: 'unknown', markdown: '' },
    }, false, translateSpy)).toBe('')
    expect(translateSpy).not.toHaveBeenCalled()
  })

  it('labels a bot workspace write as its own memory instead of the global one', () => {
    const workspaceWrite = {
      details: { action: 'write', status: 'saved', target: 'workspace', markdown: '# bot memory\n' },
    }
    expect(formatManageGlobalMemoryOutput(workspaceWrite, false, translate('zh'))).toBe('本 bot 的记忆已保存。')
    expect(formatManageGlobalMemoryOutput(workspaceWrite, false, translate('en'))).toBe('Bot memory saved.')
    // 历史消息没有 target 字段（那一版工具只会写全局），仍按全局文案渲染。
    expect(formatManageGlobalMemoryOutput({
      details: { action: 'write', status: 'saved', markdown: '# 用户信息\n' },
    }, false, translate('zh'))).toBe('全局记忆已保存。')
  })
})
