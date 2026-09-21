import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'

// A hook-state harness exercises the page's actual event handlers without adding a DOM dependency.
const harness = vi.hoisted(() => ({ states: [] as unknown[], cursor: 0, refs: [] as { current: unknown }[], refCursor: 0, effects: [] as (() => unknown)[], fetch: vi.fn() }))
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (effect: () => unknown) => { harness.effects.push(effect) },
  useRef: (initial: unknown) => {
    const index = harness.refCursor++
    if (!(index in harness.refs)) harness.refs[index] = { current: initial }
    return harness.refs[index]
  },
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => {
    const index = harness.cursor++
    if (!(index in harness.states)) harness.states[index] = typeof initial === 'function' ? initial() : initial
    return [harness.states[index], (value: unknown) => { harness.states[index] = typeof value === 'function' ? value(harness.states[index]) : value }]
  },
}))
vi.mock('../../src/lib/pi-chat', () => ({ defaultThinkingLevelForModel: () => 'off', getConfiguredModels: vi.fn(), initializePiStorage: vi.fn(), loadDefaultOptions: vi.fn() }))
vi.mock('../../src/lib/i18n', () => ({ t: (key: string) => key }))
vi.mock('../../src/lib/model-reference', () => ({ loadModelCatalog: vi.fn(), modelReferenceFromModel: () => ({ provider: 'test', id: 'model' }) }))
vi.mock('../../src/components/ui/confirm-dialog', () => ({ showConfirm: vi.fn() }))

import { ScheduledTasksPage } from '../../src/components/scheduled-tasks/ScheduledTasksPage'
import { showConfirm } from '../../src/components/ui/confirm-dialog'

type Node = ReactElement<{ children?: unknown; onClick?: () => unknown; onChange?: (event: { target: { value: string } }) => void; value?: unknown; type?: string; disabled?: boolean; checked?: boolean; 'aria-pressed'?: boolean; 'aria-label'?: string }>
function nodes(tree: unknown): Node[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!tree || typeof tree !== 'object' || !('props' in tree)) return []
  const node = tree as Node
  return [node, ...nodes(node.props.children)]
}
function text(tree: unknown): string {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree)
  if (Array.isArray(tree)) return tree.map(text).join('')
  if (tree && typeof tree === 'object' && 'props' in tree) return text((tree as Node).props.children)
  return ''
}
function render(onOpenSession?: (sessionId: string) => void) {
  harness.cursor = 0
  harness.refCursor = 0
  harness.effects = []
  return nodes(ScheduledTasksPage({ onOpenSession }))
}
function button(label: string) {
  const result = render().find((node) => node.props.onClick && text(node.props.children) === label)
  if (!result) throw new Error(`Missing button ${label}`)
  return result
}
function input(label: string) {
  const wrapper = render().find((node) => node.type === 'label' && text(node.props.children).startsWith(label))
  const result = nodes(wrapper).find((node) => node.type === 'input' || node.type === 'textarea' || node.type === 'select')
  if (!result) throw new Error(`Missing input ${label}`)
  return result
}
function change(label: string, value: string) {
  input(label).props.onChange?.({ target: { value } })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
  return { promise, resolve, reject }
}
const parsedResponse = { ok: true, json: async () => ({ needMoreInfo: false, task: { title: 'AI task', instruction: 'AI work', scheduleType: 'cron', cronExpression: '0 9 * * 1-5', scheduleRule: 'weekdays' } }) }
const taskFixture = { id: 'old', title: 'Old task', instruction: 'Old work', scheduleType: 'daily', executeTime: '12:00', scheduleRule: '12:00', status: 'enabled', runs: [], nextRunAt: '2099-01-01T12:00:00Z', createdAt: '2020-01-01T00:00:00Z' }

beforeEach(() => {
  harness.states = []
  harness.refs = []
  harness.effects = []
  harness.cursor = 0
  harness.refCursor = 0
  vi.mocked(showConfirm).mockReset()
  const model = { id: 'model', name: 'model', provider: 'test', api: 'openai-completions' }
  harness.states[11] = [model]
  harness.states[12] = model
  harness.fetch.mockReset()
  harness.fetch.mockImplementation(async () => ({ ok: true, json: async () => ({ tasks: [] }) }))
  vi.stubGlobal('fetch', harness.fetch)
})

afterEach(() => vi.unstubAllGlobals())

describe('ScheduledTasksPage manual frequency interactions', () => {
  it('edits a legacy weekly task without converting it to Cron', async () => {
    harness.states[0] = [{ id: 'old', title: 'Old task', instruction: 'Old work', scheduleType: 'weekly', weekDay: 0, executeTime: '12:00', scheduleRule: '周日 12:00', status: 'paused', runs: [], nextRunAt: '2099-01-01T12:00:00Z', createdAt: '2020-01-01T00:00:00Z' }]
    harness.states[4] = 'old'
    button('editTask').props.onClick?.()
    expect(button('taskSunday').props['aria-pressed']).toBe(true)
    expect(input('taskExecutionTime').props.value).toBe('12:00')
    change('taskTitleLabel', 'Edited')
    await button('saveTask').props.onClick?.()
    expect(harness.fetch.mock.calls[0][0]).toBe('/api/scheduled-tasks/old')
    expect(harness.fetch.mock.calls[0][1].method).toBe('PUT')
    expect(JSON.parse(harness.fetch.mock.calls[0][1].body).task).toMatchObject({ scheduleType: 'weekly', weekDays: [0], enabled: false, title: 'Edited' })
  })

  function open() {
    button('createTask').props.onClick?.()
    change('taskTitleLabel', 'Task')
    change('promptContentLabel', 'Do work')
  }

  it('creates a daily task directly, never calls AI parse, and closes on save', async () => {
    open()
    expect(button('confirmCreate').props.disabled).toBe(false)
    await button('confirmCreate').props.onClick?.()
    const [url, options] = harness.fetch.mock.calls[0]
    expect(url).toBe('/api/scheduled-tasks')
    expect(JSON.parse(options.body).task).toMatchObject({ scheduleType: 'daily', executeTime: '09:00', title: 'Task' })
    expect(harness.fetch.mock.calls.some(([url]) => String(url).endsWith('/parse'))).toBe(false)
    expect(render().some((node) => text(node.props.children) === 'confirmCreate')).toBe(false)
  })

  it('switches frequencies, toggles weekdays, blocks empty selection, and strips inactive values on save', async () => {
    open()
    change('taskFrequency', 'weekly')
    expect(button('taskMonday').props['aria-pressed']).toBe(true)
    button('taskMonday').props.onClick?.()
    expect(button('confirmCreate').props.disabled).toBe(true)
    button('taskWednesday').props.onClick?.()
    button('taskFriday').props.onClick?.()
    expect(button('confirmCreate').props.disabled).toBe(false)
    await button('confirmCreate').props.onClick?.()
    const payload = JSON.parse(harness.fetch.mock.calls[0][1].body).task
    expect(payload.weekDays).toEqual([3, 5])
    expect(payload.cronExpression).toBeUndefined()
    expect(payload.intervalValue).toBeUndefined()
  })

  it('validates interval input and posts first execution in ISO form', async () => {
    open()
    change('taskFrequency', 'interval')
    change('taskIntervalValue', '0')
    expect(button('confirmCreate').props.disabled).toBe(true)
    change('taskIntervalValue', '2')
    change('taskIntervalUnit', 'hour')
    change('taskFirstExecution', '2099-01-01T09:00')
    await button('confirmCreate').props.onClick?.()
    expect(JSON.parse(harness.fetch.mock.calls[0][1].body).task).toMatchObject({ scheduleType: 'interval', intervalValue: 2, intervalUnit: 'hour', executeAt: new Date('2099-01-01T09:00').toISOString() })
  })

  it('AI parsing fills editable Cron and manual changes clear stale parse confirmation', async () => {
    open()
    change('taskScheduleDescriptionLabel', 'every weekday')
    harness.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ needMoreInfo: false, task: { title: 'AI task', instruction: 'Do AI work', scheduleType: 'cron', cronExpression: '0 9 * * 1-5', scheduleRule: 'weekdays', nextRunAt: '2099-01-01T09:00:00Z' } }) })
    await button('aiParseTask').props.onClick?.()
    expect(input('taskCronExpression').props.value).toBe('0 9 * * 1-5')
    expect(render().some((node) => text(node.props.children).includes('aiParsed'))).toBe(true)
    change('taskCronExpression', '*/15 * * * *')
    expect(render().some((node) => text(node.props.children).includes('aiParsed'))).toBe(false)
    await button('confirmCreate').props.onClick?.()
    expect(JSON.parse(harness.fetch.mock.calls[1][1].body).task.cronExpression).toBe('*/15 * * * *')
  })

  it.each(['parse', 'save'] as const)('deduplicates pending %s and excludes the other operation before re-render', async (operation) => {
    open()
    change('taskScheduleDescriptionLabel', 'every weekday')
    const parse = button('aiParseTask').props.onClick!
    const save = button('confirmCreate').props.onClick!
    const cancel = button('cancel').props.onClick!
    const pending = deferred<typeof parsedResponse>()
    harness.fetch.mockReturnValueOnce(pending.promise)
    const first = operation === 'parse' ? parse() : save()
    await parse()
    await save()
    cancel()
    expect(harness.fetch).toHaveBeenCalledTimes(1)
    expect(button('aiParseTask').props.disabled).toBe(true)
    expect(button('confirmCreate').props.disabled).toBe(true)
    expect(button('back').props.disabled).toBe(true)
    expect(render().some((node) => node.type === 'fieldset' && node.props.disabled)).toBe(true)
    pending.resolve(parsedResponse)
    await first
    if (operation === 'parse') {
      expect(input('taskTitleLabel').props.value).toBe('AI task')
      expect(button('confirmCreate').props.disabled).toBe(false)
    } else {
      expect(button('createTask').props.disabled).not.toBe(true)
    }
  })

  it('does not replace the editor through a stale edit handler while parsing', async () => {
    harness.states[0] = [taskFixture]
    harness.states[4] = 'old'
    const edit = button('editTask').props.onClick!
    edit()
    change('taskTitleLabel', 'Draft')
    const pending = deferred<typeof parsedResponse>()
    harness.fetch.mockReturnValueOnce(pending.promise)
    const first = button('aiParseTask').props.onClick?.()
    edit()
    expect(input('taskTitleLabel').props.value).toBe('Draft')
    pending.resolve(parsedResponse)
    await first
    expect(input('taskTitleLabel').props.value).toBe('AI task')
  })

  it('ignores a stale parse handler after the editor has closed', async () => {
    open()
    change('taskScheduleDescriptionLabel', 'every weekday')
    const parse = button('aiParseTask').props.onClick!
    button('cancel').props.onClick?.()
    await parse()
    expect(harness.fetch).not.toHaveBeenCalled()
    button('createTask').props.onClick?.()
    expect(input('taskTitleLabel').props.value).toBe('')
  })

  it('unlocks after a parse rejection and allows retry', async () => {
    open()
    change('taskScheduleDescriptionLabel', 'every weekday')
    const pending = deferred<typeof parsedResponse>()
    harness.fetch.mockReturnValueOnce(pending.promise)
    const first = button('aiParseTask').props.onClick?.()
    pending.reject(new Error('Parse rejected'))
    await first
    expect(input('taskTitleLabel').props.value).toBe('Task')
    expect(button('aiParseTask').props.disabled).toBe(false)
    harness.fetch.mockResolvedValueOnce(parsedResponse)
    await button('aiParseTask').props.onClick?.()
    expect(input('taskTitleLabel').props.value).toBe('AI task')
    expect(harness.fetch).toHaveBeenCalledTimes(2)
  })

  it('does not apply a late parse response after the editor is unmounted', async () => {
    open()
    change('taskScheduleDescriptionLabel', 'every weekday')
    const parse = button('aiParseTask').props.onClick!
    const cleanup = harness.effects[0]() as () => void
    const pending = deferred<typeof parsedResponse>()
    harness.fetch.mockReturnValueOnce(pending.promise)
    const first = parse()
    cleanup()
    pending.resolve(parsedResponse)
    await first
    expect((harness.states[2] as { title: string }).title).toBe('Task')
    expect(harness.states[7]).toBeNull()
  })

  it('retains independent once and interval date drafts across frequency changes and AI parsing', async () => {
    open()
    change('taskFrequency', 'once')
    change('taskExecutionDate', '2099-01-02T10:00')
    change('taskFrequency', 'interval')
    expect(input('taskFirstExecution').props.value).not.toBe('2099-01-02T10:00')
    change('taskFirstExecution', '2099-02-03T11:00')
    change('taskIntervalValue', '7')
    change('taskFrequency', 'once')
    expect(input('taskExecutionDate').props.value).toBe('2099-01-02T10:00')
    change('taskFrequency', 'daily')
    change('taskFrequency', 'interval')
    expect(input('taskFirstExecution').props.value).toBe('2099-02-03T11:00')
    expect(input('taskIntervalValue').props.value).toBe('7')
    change('taskScheduleDescriptionLabel', 'every weekday')
    harness.fetch.mockResolvedValueOnce(parsedResponse)
    await button('aiParseTask').props.onClick?.()
    change('taskFrequency', 'once')
    expect(input('taskExecutionDate').props.value).toBe('2099-01-02T10:00')
    change('taskFrequency', 'interval')
    expect(input('taskFirstExecution').props.value).toBe('2099-02-03T11:00')
    expect(input('taskIntervalValue').props.value).toBe('7')
  })

  it('keeps an existing interval anchor including seconds after editing the once draft', async () => {
    const anchor = '2020-01-01T01:02:03.456Z'
    harness.states[0] = [{ ...taskFixture, scheduleType: 'interval', executeAt: anchor, intervalValue: 2, intervalUnit: 'hour' }]
    harness.states[4] = 'old'
    button('editTask').props.onClick?.()
    const originalDraft = input('taskFirstExecution').props.value
    change('taskFrequency', 'once')
    change('taskExecutionDate', '2099-01-02T10:00')
    change('taskFrequency', 'interval')
    expect(input('taskFirstExecution').props.value).toBe(originalDraft)
    await button('saveTask').props.onClick?.()
    expect(JSON.parse(harness.fetch.mock.calls[0][1].body).task.executeAt).toBe(anchor)
  })

  it('deduplicates task actions by ID and unlocks after failure', async () => {
    harness.states[0] = [taskFixture]
    harness.states[4] = 'old'
    const run = button('executeNow').props.onClick!
    const remove = button('deleteTask').props.onClick!
    const pending = deferred<typeof parsedResponse>()
    harness.fetch.mockReturnValueOnce(pending.promise)
    const first = run()
    await run()
    await remove()
    expect(harness.fetch).toHaveBeenCalledTimes(1)
    expect(showConfirm).not.toHaveBeenCalled()
    expect(button('executeNow').props.disabled).toBe(true)
    expect(button('editTask').props.disabled).toBe(true)
    expect(button('deleteTask').props.disabled).toBe(true)
    pending.reject(new Error('Run rejected'))
    await first
    expect(button('executeNow').props.disabled).toBe(false)
    await button('executeNow').props.onClick?.()
    expect(harness.fetch.mock.calls.filter(([url]) => String(url).endsWith('/run'))).toHaveLength(2)
  })

  it.each([true, false])('deduplicates delete confirmation and unlocks after confirmation=%s', async (confirmed) => {
    harness.states[0] = [taskFixture]
    harness.states[4] = 'old'
    const remove = button('deleteTask').props.onClick!
    const run = button('executeNow').props.onClick!
    const pending = deferred<boolean>()
    vi.mocked(showConfirm).mockReturnValueOnce(pending.promise)
    const first = remove()
    await remove()
    await run()
    expect(showConfirm).toHaveBeenCalledTimes(1)
    expect(harness.fetch).not.toHaveBeenCalled()
    expect(button('deleteTask').props.disabled).toBe(true)
    pending.resolve(confirmed)
    await first
    expect(harness.fetch.mock.calls.filter(([, options]) => options?.method === 'DELETE')).toHaveLength(confirmed ? 1 : 0)
    if (!confirmed) expect(button('deleteTask').props.disabled).toBe(false)
  })

  it('allows independent task actions while disabling only the pending task switch', async () => {
    harness.states[0] = [taskFixture, { ...taskFixture, id: 'other' }]
    const taskSwitches = render().filter((node) => node.type === 'input' && node.props.type === 'checkbox' && node.props['aria-label'] === 'taskEnabledSwitch')
    const pending = deferred<typeof parsedResponse>()
    harness.fetch.mockReturnValueOnce(pending.promise)
    const first = taskSwitches[0].props.onChange?.({ target: { value: '' } })
    await taskSwitches[0].props.onChange?.({ target: { value: '' } })
    const renderedSwitches = render().filter((node) => node.type === 'input' && node.props.type === 'checkbox' && node.props['aria-label'] === 'taskEnabledSwitch')
    expect(renderedSwitches.map((node) => node.props.disabled)).toEqual([true, false])
    await taskSwitches[1].props.onChange?.({ target: { value: '' } })
    expect(harness.fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(2)
    pending.resolve(parsedResponse)
    await first
  })

  it('retains editor and user values when save fails', async () => {
    open()
    harness.fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Save rejected' }) })
    await button('confirmCreate').props.onClick?.()
    expect(input('taskTitleLabel').props.value).toBe('Task')
    expect(button('confirmCreate').props.disabled).toBe(false)
    expect(render().some((node) => text(node.props.children) === 'Save rejected')).toBe(true)
    await button('confirmCreate').props.onClick?.()
    expect(harness.fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(2)
    expect(button('createTask').props.disabled).not.toBe(true)
  })
})

describe('ScheduledTasksPage task detail recent executions', () => {
  it('renders compact run rows with per-run view-conversation actions and no run detail fields', () => {
    harness.states[0] = [{
      ...taskFixture,
      lastSessionId: 'session-last',
      runs: [
        { id: 'run-a', status: 'success', trigger: 'schedule', startedAt: '2026-01-01T00:00:00Z', durationMs: 12, sessionId: 'session-a', agentLabel: 'Agent X', inputContent: 'secret input', aiResult: 'secret result' },
        { id: 'run-b', status: 'failed', trigger: 'manual', startedAt: '2026-01-02T00:00:00Z', errorMessage: 'boom', warning: 'careful' },
      ],
    }]
    harness.states[4] = 'old'
    const opened: string[] = []
    const tree = render((sessionId) => { opened.push(sessionId) })
    const actions = tree.filter((node) => node.props['aria-label'] === 'viewConversation' || node.props['aria-label'] === 'runNoSession')
    expect(actions).toHaveLength(2)
    expect(actions[0].props['aria-label']).toBe('viewConversation')
    expect(actions[0].props.disabled).toBe(false)
    actions[0].props.onClick?.()
    expect(opened).toEqual(['session-a'])
    expect(actions[1].props['aria-label']).toBe('runNoSession')
    expect(actions[1].props.disabled).toBe(true)
    actions[1].props.onClick?.()
    expect(opened).toEqual(['session-a'])
    const rendered = text(tree)
    expect(rendered).toContain('recentExecutions')
    expect(rendered).toContain('executionSuccess')
    expect(rendered).toContain('taskFailed')
    expect(rendered).not.toContain('runInputContent')
    expect(rendered).not.toContain('runAiResult')
    expect(rendered).not.toContain('secret input')
    expect(rendered).not.toContain('secret result')
    expect(rendered).not.toContain('Agent X')
    expect(rendered).not.toContain('boom')
    expect(rendered).not.toContain('careful')
    expect(rendered).not.toContain('12ms')
    expect(tree.some((node) => node.type === 'summary')).toBe(false)
  })
})

describe('ScheduledTasksPage execution history rows', () => {
  it('renders plain rows with a per-run view-conversation action and no expandable details', () => {
    harness.states[1] = 'history'
    harness.states[18] = {
      runs: [
        { id: 'run-a', taskId: 'task-1', taskTitle: 'Task A', status: 'success', trigger: 'manual', startedAt: '2026-01-01T00:00:00Z', durationMs: 12, sessionId: 'session-a' },
        { id: 'run-b', taskId: 'task-1', taskTitle: 'Task B', status: 'failed', trigger: 'schedule', startedAt: '2026-01-02T00:00:00Z', errorMessage: 'boom' },
      ],
      total: 2,
      page: 1,
      pageSize: 10,
    }
    const opened: string[] = []
    const tree = render((sessionId) => { opened.push(sessionId) })
    const actions = tree.filter((node) => node.props['aria-label'] === 'viewConversation' || node.props['aria-label'] === 'runNoSession')
    expect(actions).toHaveLength(2)
    expect(actions[0].props['aria-label']).toBe('viewConversation')
    expect(actions[0].props.disabled).toBe(false)
    actions[0].props.onClick?.()
    expect(opened).toEqual(['session-a'])
    expect(actions[1].props['aria-label']).toBe('runNoSession')
    expect(actions[1].props.disabled).toBe(true)
    actions[1].props.onClick?.()
    expect(opened).toEqual(['session-a'])
    const rendered = text(tree)
    expect(rendered).not.toContain('runInputContent')
    expect(rendered).not.toContain('runAiResult')
    expect(rendered).not.toContain('executionAgent')
    expect(rendered).not.toContain('boom')
  })
})
