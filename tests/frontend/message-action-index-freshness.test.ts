// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { decorateMessages } from '@/components/chat/panel-decoration/message-actions'
import { INLINE_EDITOR_CLASS } from '@/components/chat/panel-decoration/inline-message-editor'

/**
 * 动作按钮的索引必须「触发时现读」，不能冻在装饰那一刻。
 *
 * 契约来源：`MessageList` 每次提交都把 `messageIndexOffset + 窗口内序号` 写回行上的
 * `data-message-index`（滚动锚点同样读它）。动作组只在建行时创建一次、之后复用，
 * 所以闭包里冻结的索引会随分页/回滚重切片过期——过期索引会让回滚截在另一条消息
 * 上、重试重跑错轮、复制读到别人的正文。
 */

type Row = { element: HTMLElement; text: string }

function buildList(texts: string[]): Row[] {
  document.body.innerHTML = `
    <div class="qf-message-list">
      ${texts.map((text, index) => (index % 2 === 0
        ? `<div class="qf-user-message"><div class="user-message-container"><span class="bubble-text">${text}</span></div></div>`
        : `<div class="qf-assistant-message"><p>${text}</p></div>`)).join('')}
    </div>`
  return Array.from(document.querySelectorAll<HTMLElement>('.qf-message-list > div'))
    .map((element, index) => ({ element, text: texts[index] }))
}

/** 模拟 `MessageList` 的布局副作用：把当前窗口的全量索引写回每一行。 */
function stampIndexes(rows: Row[], windowStart: number) {
  rows.forEach((row, index) => {
    row.element.dataset.messageIndex = String(windowStart + index)
  })
}

function messagesFrom(texts: string[]) {
  return texts.map((text, index) => (index % 2 === 0
    ? { role: 'user', content: text, timestamp: 1_750_000_000_000 + index }
    : { role: 'assistant', content: [{ type: 'text', text }], timestamp: 1_750_000_000_000 + index })) as never
}

const texts = ['第一个问题', '第一个回答', '第二个问题']

function decorate(rows: Row[], options: {
  texts?: string[]
  windowStart: number
  onRollbackFromMessage?: (index: number) => void
  onEditMessageAndResend?: (index: number, text: string) => Promise<boolean>
  onRetryFromMessage?: (index: number) => void
  onCopyAnswer?: (text: string) => void
  getMessageAtFullIndex?: (fullIndex: number) => never | undefined
}) {
  stampIndexes(rows, options.windowStart)
  decorateMessages({
    panel: document.body,
    getMessages: () => messagesFrom(options.texts ?? texts),
    messageIndexOffset: options.windowStart,
    getMessageAtFullIndex: options.getMessageAtFullIndex,
    isStreaming: () => false,
    onCopyAnswer: options.onCopyAnswer ?? vi.fn(),
    onRollbackFromMessage: options.onRollbackFromMessage ?? vi.fn(),
    onEditMessageAndResend: options.onEditMessageAndResend,
    onRetryFromMessage: options.onRetryFromMessage ?? vi.fn(),
    onForkFromMessage: vi.fn(),
    disableFork: false,
  })
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('decorated actions read the live message index', () => {
  it('submits the inline edit with the row index from the current window, not the captured one', async () => {
    const rows = buildList(texts)
    const onEditMessageAndResend = vi.fn(async () => true)

    // 第一遍：窗口从全对话第 10 条开始，按钮在此刻创建并捕获 10/11/12。
    decorate(rows, { windowStart: 10, onEditMessageAndResend })
    // 第二遍：向上翻页后同一批行改从第 4 条开始（索引 4/5/6），行被重新装饰、
    // 按钮被复用——点下去必须按新索引截断。
    decorate(rows, { windowStart: 4, onEditMessageAndResend })

    const rollback = rows[0].element.querySelector<HTMLButtonElement>('button[data-quickforge-action="rollback"]')
    expect(rollback).not.toBeNull()
    rollback?.click()

    const textarea = rows[0].element.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea.value).toBe('第一个问题')
    ;(rows[0].element.querySelector(`.${INLINE_EDITOR_CLASS}-submit`) as HTMLButtonElement).click()

    await vi.waitFor(() => expect(onEditMessageAndResend).toHaveBeenCalledTimes(1))
    expect(onEditMessageAndResend).toHaveBeenCalledWith(4, '第一个问题')
  })

  it('retries the last user turn by its live index', () => {
    const rows = buildList(texts)
    const onRetryFromMessage = vi.fn()

    decorate(rows, { windowStart: 10, onRetryFromMessage })
    decorate(rows, { windowStart: 4, onRetryFromMessage })

    const retry = rows[2].element.querySelector<HTMLButtonElement>('button[data-quickforge-action="retry"]')
    expect(retry).not.toBeNull()
    retry?.click()

    expect(onRetryFromMessage).toHaveBeenCalledWith(6)
  })

  it('copies the message the host currently holds at that index', async () => {
    const rows = buildList(texts)
    const onCopyAnswer = vi.fn()
    // 宿主读取器读的是「此刻」的窗口，装饰时冻结的是同一行为的函数（真实宿主
    // 通过 ref 现读，任何一轮创建的闭包等价）。这里用可变快照模拟定稿替换。
    let current = messagesFrom(texts) as never[]
    const getMessageAtFullIndex = vi.fn((fullIndex: number) => current[fullIndex] as never)

    decorate(rows, { windowStart: 0, onCopyAnswer, getMessageAtFullIndex })
    current = messagesFrom(['第一个问题', '最终回答', '第二个问题']) as never[]
    decorate(rows, { windowStart: 0, onCopyAnswer, getMessageAtFullIndex })

    const copy = rows[1].element.querySelector<HTMLButtonElement>('button[data-quickforge-action="copy"]')
    expect(copy).not.toBeNull()
    copy?.click()

    await vi.waitFor(() => expect(onCopyAnswer).toHaveBeenCalledWith('最终回答'))
    expect(getMessageAtFullIndex).toHaveBeenCalledWith(1)
  })
})
