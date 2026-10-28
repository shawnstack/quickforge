// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { t } from '@/lib/i18n'
import { decorateMessages } from '@/components/chat/panel-decoration/message-actions'
import {
  closeInlineMessageEditor,
  closeInlineMessageEditors,
  hasInlineMessageEditor,
  INLINE_EDITOR_CLASS,
  MESSAGE_DOOMED_CLASS,
  openInlineMessageEditor,
  REMOVAL_DIVIDER_CLASS,
} from '@/components/chat/panel-decoration/inline-message-editor'

function buildList() {
  document.body.innerHTML = `
    <div class="qf-message-list">
      <div class="qf-user-message" data-row="0"><div class="user-message-container"><span class="bubble-text">把 retry 抽成独立函数</span></div></div>
      <div class="qf-assistant-message" data-row="1"><p>已抽出 withRetry()</p></div>
      <div class="qf-user-message" data-row="2"><div class="user-message-container"><span>顺便把超时做成可配置</span></div></div>
    </div>`
  const list = document.querySelector('.qf-message-list') as HTMLElement
  const rows = Array.from(list.children) as HTMLElement[]
  return { list, rows }
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('inline message editor', () => {
  it('opens in place, pre-fills the original text and dims the messages below', () => {
    const { list, rows } = buildList()
    const [row, assistant, following] = rows
    const onSubmit = vi.fn(async () => true)

    openInlineMessageEditor({ row, initialText: '把 retry 抽成独立函数', onSubmit })

    const container = row.querySelector('.user-message-container') as HTMLElement
    expect(container.classList.contains('quickforge-inline-editor-host')).toBe(true)
    expect(row.dataset.quickforgeEditing).toBe('true')
    expect(hasInlineMessageEditor(list)).toBe(true)

    const textarea = row.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea.value).toBe('把 retry 抽成独立函数')

    // 代价前置：后续行就地变淡 + 虚线说明
    expect(assistant.classList.contains(MESSAGE_DOOMED_CLASS)).toBe(true)
    expect(following.classList.contains(MESSAGE_DOOMED_CLASS)).toBe(true)
    const divider = list.querySelector(`.${REMOVAL_DIVIDER_CLASS}`)
    expect(divider).not.toBeNull()
    expect(divider?.nextElementSibling).toBe(assistant)
    expect(divider?.textContent).toBe(t('removalDividerLabel', { count: 2 }))

    expect(row.textContent).toContain(t('editMessageRemovesFollowing', { count: 2 }))
  })

  it('submits the edited text through the callback and closes on success', async () => {
    const { list, rows } = buildList()
    const [row] = rows
    const onSubmit = vi.fn(async () => true)
    openInlineMessageEditor({ row, initialText: '旧文案', onSubmit })

    const textarea = row.querySelector('textarea') as HTMLTextAreaElement
    textarea.value = '  新的文案  '
    textarea.dispatchEvent(new Event('input'))

    const submit = row.querySelector(`.${INLINE_EDITOR_CLASS}-submit`) as HTMLButtonElement
    submit.click()
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))

    expect(onSubmit).toHaveBeenCalledWith('新的文案')
    await vi.waitFor(() => expect(hasInlineMessageEditor(list)).toBe(false))
    expect(row.dataset.quickforgeEditing).toBeUndefined()
    expect(list.querySelector(`.${MESSAGE_DOOMED_CLASS}`)).toBeNull()
    expect(list.querySelector(`.${REMOVAL_DIVIDER_CLASS}`)).toBeNull()
  })

  it('keeps the editor open and restores the footer when the submit fails', async () => {
    const { rows } = buildList()
    const [row] = rows
    const onSubmit = vi.fn(async () => false)
    openInlineMessageEditor({ row, initialText: '旧文案', onSubmit })

    const submit = row.querySelector(`.${INLINE_EDITOR_CLASS}-submit`) as HTMLButtonElement
    submit.click()
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled())

    expect(row.dataset.quickforgeEditing).toBe('true')
    expect(submit.disabled).toBe(false)
    expect(submit.textContent).toContain(t('editMessageSend'))
    expect((row.querySelector('textarea') as HTMLTextAreaElement).readOnly).toBe(false)
  })

  it('sends on Enter and keeps the line break on Shift+Enter', () => {
    const { rows } = buildList()
    const [row] = rows
    const onSubmit = vi.fn(async () => true)
    openInlineMessageEditor({ row, initialText: '旧文案', onSubmit })
    const textarea = row.querySelector('textarea') as HTMLTextAreaElement

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))
    expect(onSubmit).not.toHaveBeenCalled()

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('cancels with Escape without touching history', () => {
    const { list, rows } = buildList()
    const [row, assistant] = rows
    openInlineMessageEditor({ row, initialText: '旧文案', onSubmit: vi.fn(async () => true) })

    const textarea = row.querySelector('textarea') as HTMLTextAreaElement
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(hasInlineMessageEditor(list)).toBe(false)
    expect(assistant.classList.contains(MESSAGE_DOOMED_CLASS)).toBe(false)
    expect(list.querySelector(`.${REMOVAL_DIVIDER_CLASS}`)).toBeNull()
    expect(row.dataset.quickforgeEditing).toBeUndefined()
  })

  it('closes the previously open editor when another row starts editing', () => {
    const { list, rows } = buildList()
    const [first, , third] = rows
    openInlineMessageEditor({ row: first, initialText: 'A', onSubmit: vi.fn(async () => true) })
    closeInlineMessageEditors(list)
    expect(hasInlineMessageEditor(list)).toBe(false)

    openInlineMessageEditor({ row: third, initialText: 'B', onSubmit: vi.fn(async () => true) })
    closeInlineMessageEditor(third)
    expect(third.dataset.quickforgeEditing).toBeUndefined()
    expect(list.querySelector(`.${INLINE_EDITOR_CLASS}`)).toBeNull()
  })

  it('opens the editor from the decorated rollback button instead of a confirm popover', () => {
    const { list, rows } = buildList()
    const [row] = rows
    const onEditMessageAndResend = vi.fn(async () => true)
    decorateMessages({
      panel: document.body,
      getMessages: () => ([
        { role: 'user', content: '把 retry 抽成独立函数', timestamp: 1_750_000_000_000 },
        { role: 'assistant', content: [{ type: 'text', text: '已抽出 withRetry()' }] },
      ]) as never,
      isStreaming: () => false,
      onCopyAnswer: vi.fn(),
      onRollbackFromMessage: vi.fn(),
      onEditMessageAndResend,
      onRetryFromMessage: vi.fn(),
      onForkFromMessage: vi.fn(),
      disableFork: false,
    })

    const rollback = row.querySelector<HTMLButtonElement>('button[data-quickforge-action="rollback"]')
    expect(rollback).not.toBeNull()
    expect(rollback?.title).toBe(t('editMessage'))
    expect(rollback?.getAttribute('aria-haspopup')).toBeNull()

    rollback?.click()

    expect(document.querySelector('.quickforge-rollback-popover')).toBeNull()
    expect(row.dataset.quickforgeEditing).toBe('true')
    expect(hasInlineMessageEditor(list)).toBe(true)
    expect(row.querySelector('textarea')?.value).toBe('把 retry 抽成独立函数')

    // 二次点击同一图标 = 取消编辑
    rollback?.click()
    expect(row.dataset.quickforgeEditing).toBeUndefined()
    expect(list.querySelector(`.${INLINE_EDITOR_CLASS}`)).toBeNull()
  })
})
