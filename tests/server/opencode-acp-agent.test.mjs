import { afterEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import {
  OpenCodeAcpAgent,
  normalizeOpenCodeHistoryMessages,
  normalizeOpenCodeSessionSetupResult,
  resolveOpenCodeCommand,
  sanitizeOpenCodeDiagnostic,
} from '../../server/opencode-acp-agent.mjs'

const originalPath = process.env.PATH

afterEach(() => {
  process.env.PATH = originalPath
})

function createAgent(overrides = {}) {
  const agent = new OpenCodeAcpAgent({
    sessionId: 'quickforge-session',
    cwd: process.cwd(),
    messages: [],
    requestPermission: undefined,
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    ...overrides,
  })
  agent.harnessSessionId = 'acp-session'
  agent.acceptUpdates = true
  return agent
}

function textChunk(agent, messageId, text, type = 'agent_message_chunk') {
  agent.handleSessionUpdate({
    sessionId: 'acp-session',
    update: { sessionUpdate: type, messageId, content: { type: 'text', text } },
  })
}

describe('OpenCode history tool normalization', () => {
  it('normalizes legacy names, multiple calls, arguments, and matching results without mutating input', () => {
    const messages = [
      {
        role: 'assistant', api: 'acp', provider: 'opencode', timestamp: 1,
        content: [
          { type: 'text', text: 'before' },
          { type: 'toolCall', id: 'read', name: 'read', arguments: { file_path: 'a.txt' } },
          { type: 'toolCall', id: 'bash', name: 'bash', arguments: 'npm test' },
          { type: 'toolCall', id: 'todo', name: 'todowrite', arguments: null },
          { type: 'toolCall', id: 'generic', name: 'Tool Call', arguments: ['x'] },
          { type: 'toolCall', id: 'dynamic', name: 'Inspect workspace now', arguments: { value: 1 } },
        ],
      },
      { role: 'toolResult', toolCallId: 'read', toolName: 'read', content: [{ type: 'text', text: 'a' }], details: { output: 'a' }, isError: false, timestamp: 2 },
      { role: 'toolResult', toolCallId: 'bash', toolName: 'bash', content: [], isError: true, timestamp: 3 },
      { role: 'toolResult', toolCallId: 'orphan', toolName: 'bash', content: [], details: { untouched: true }, isError: false, timestamp: 4 },
    ]
    const snapshot = structuredClone(messages)

    const normalized = normalizeOpenCodeHistoryMessages(messages)
    const calls = normalized[0].content.filter((block) => block.type === 'toolCall')

    expect(calls.map((call) => call.name)).toEqual(['read_file', 'opencode_tool', 'opencode_tool', 'opencode_tool', 'opencode_tool'])
    expect(calls.every((call) => ['read_file', 'edit_file', 'grep_files', 'run_command', 'opencode_tool'].includes(call.name))).toBe(true)
    expect(calls[0].arguments).toEqual({ file_path: 'a.txt', __quickforgeAcp: { kind: 'read' } })
    expect(calls[1].arguments).toEqual({ rawInput: 'npm test', __quickforgeAcp: { kind: 'bash' } })
    expect(calls[2].arguments).toEqual({ rawInput: null, __quickforgeAcp: { kind: 'todowrite' } })
    expect(calls[3].arguments).toEqual({ rawInput: ['x'], __quickforgeAcp: { kind: 'Tool Call' } })
    expect(calls[4].arguments.__quickforgeAcp).toEqual({ kind: 'Inspect workspace now' })
    expect(normalized[0].content[0]).toBe(messages[0].content[0])
    expect(normalized[1]).toMatchObject({ toolName: 'read_file', content: messages[1].content, isError: false, timestamp: 2, details: { output: 'a', __quickforgeAcp: { kind: 'read' } } })
    expect(normalized[2]).toMatchObject({ toolName: 'opencode_tool', content: [], isError: true, timestamp: 3, details: { __quickforgeAcp: { kind: 'bash' } } })
    expect(normalized[3]).toBe(messages[3])
    expect(messages).toEqual(snapshot)
  })

  it('preserves renderer names, sanitizes metadata, and is idempotent', () => {
    const messages = [{
      role: 'assistant', api: 'acp', provider: 'opencode',
      content: [{
        type: 'toolCall', id: 'new', name: 'read_file',
        arguments: {
          path: 'README.md',
          __quickforgeAcp: {
            title: 'Read file', kind: 'read', unknown: 'drop', _meta: { secret: true },
            locations: [{ path: 'README.md', line: 2, unknown: true, _meta: { secret: true } }],
          },
        },
      }],
    }, {
      role: 'toolResult', toolCallId: 'new', toolName: 'read_file', content: [], details: { output: 'ok', __quickforgeAcp: { title: 'stale', unknown: true } }, isError: false,
    }]

    const once = normalizeOpenCodeHistoryMessages(messages)
    const twice = normalizeOpenCodeHistoryMessages(once)

    expect(once).toEqual(twice)
    expect(once[0].content[0]).toEqual({
      type: 'toolCall', id: 'new', name: 'read_file',
      arguments: { path: 'README.md', __quickforgeAcp: { title: 'Read file', kind: 'read', locations: [{ path: 'README.md', line: 2 }] } },
    })
    expect(once[1].details).toEqual({ output: 'ok', __quickforgeAcp: { title: 'Read file', kind: 'read', locations: [{ path: 'README.md', line: 2 }] } })
  })

  it('does not touch non-OpenCode ACP, QuickForge, MCP, or plain assistant messages', () => {
    const messages = [
      { role: 'assistant', api: 'acp', provider: 'other', content: [{ type: 'toolCall', id: 'other', name: 'read', arguments: {} }] },
      { role: 'assistant', api: 'quickforge', provider: 'opencode', content: [{ type: 'toolCall', id: 'qf', name: 'bash', arguments: {} }] },
      { role: 'assistant', api: 'mcp', provider: 'opencode', content: [{ type: 'toolCall', id: 'mcp', name: 'Tool Call', arguments: {} }] },
      { role: 'assistant', api: 'acp', provider: 'opencode', content: [{ type: 'text', text: 'plain' }] },
      { role: 'toolResult', toolCallId: 'other', toolName: 'read', content: [] },
    ]

    const normalized = normalizeOpenCodeHistoryMessages(messages)
    expect(normalized).toEqual(messages)
    normalized.forEach((message, index) => expect(message).toBe(messages[index]))
  })

  it('normalizes restored constructor messages before exposing state', () => {
    const messages = [{
      role: 'assistant', api: 'acp', provider: 'opencode',
      content: [{ type: 'toolCall', id: 'legacy', name: 'todowrite', arguments: { todos: [] } }],
    }]

    const agent = createAgent({ messages })

    expect(agent.state.messages[0].content[0]).toMatchObject({ name: 'opencode_tool', arguments: { todos: [], __quickforgeAcp: { kind: 'todowrite' } } })
    expect(messages[0].content[0].name).toBe('todowrite')
  })
})

describe('OpenCode command resolution', () => {
  it('resolves the platform command from PATH without a user-specific path', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'quickforge-opencode-'))
    const command = path.join(directory, process.platform === 'win32' ? 'opencode.cmd' : 'opencode')
    await fs.writeFile(command, '')
    process.env.PATH = directory

    await expect(resolveOpenCodeCommand()).resolves.toBe(command)
    await fs.rm(directory, { recursive: true, force: true })
  })

  it('returns a clear unavailable error', async () => {
    process.env.PATH = ''
    await expect(resolveOpenCodeCommand()).rejects.toMatchObject({
      statusCode: 503,
      errorCode: 'OPENCODE_UNAVAILABLE',
    })
  })
})

describe('OpenCode ACP runtime mapping', () => {
  it('segments message IDs and preserves text/thinking receive order', () => {
    const agent = createAgent()
    textChunk(agent, 'message-1', 'Answer ')
    textChunk(agent, 'message-1', 'reason', 'agent_thought_chunk')
    textChunk(agent, 'message-1', 'ing', 'agent_thought_chunk')
    textChunk(agent, 'message-1', ' done')
    textChunk(agent, 'message-2', 'Second')
    agent.finishAssistantMessage('end_turn')

    expect(agent.state.messages).toEqual([
      expect.objectContaining({
        id: 'message-1',
        content: [
          { type: 'text', text: 'Answer ' },
          { type: 'thinking', thinking: 'reasoning' },
          { type: 'text', text: ' done' },
        ],
      }),
      expect.objectContaining({ id: 'message-2', content: [{ type: 'text', text: 'Second' }], stopReason: 'end_turn' }),
    ])
  })

  it('persists text, toolCall, toolResult, then later text in order', () => {
    const agent = createAgent()
    textChunk(agent, 'message-1', 'Before')
    agent.handleSessionUpdate({
      sessionId: 'acp-session',
      update: { sessionUpdate: 'tool_call', messageId: 'tool-message', toolCallId: 'tool-1', title: 'Read file', kind: 'read', rawInput: { path: 'README.md' } },
    })
    agent.handleSessionUpdate({
      sessionId: 'acp-session',
      update: { sessionUpdate: 'tool_call_update', toolCallId: 'tool-1', status: 'completed', rawOutput: 'done' },
    })
    textChunk(agent, 'message-2', 'After')
    agent.finishAssistantMessage()

    expect(agent.state.messages.map((message) => message.role)).toEqual(['assistant', 'assistant', 'toolResult', 'assistant'])
    expect(agent.state.messages[1]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'tool-1', name: 'read_file', arguments: { path: 'README.md', __quickforgeAcp: { title: 'Read file', kind: 'read' } } }],
    })
    expect(agent.state.messages[2]).toMatchObject({ toolCallId: 'tool-1', isError: false })
  })

  it('maps only standard ACP kinds, normalizes aliases, and keeps generic ACP metadata without _meta', () => {
    const agent = createAgent()
    const cases = [
      ['read', { file_path: 'a.txt' }, 'read_file', { path: 'a.txt' }],
      ['edit', { file_path: 'b.txt' }, 'edit_file', { path: 'b.txt' }],
      ['search', { pattern: 'needle', useRegex: true }, 'grep_files', { query: 'needle', regex: true }],
      ['execute', { cmd: 'npm test' }, 'run_command', { command: 'npm test' }],
    ]
    for (const [kind, rawInput, name, normalized] of cases) {
      agent.handleSessionUpdate({
        sessionId: 'acp-session',
        update: { sessionUpdate: 'tool_call', toolCallId: kind, title: `ACP ${kind}`, kind, rawInput, _meta: { secret: true } },
      })
      const call = agent.state.messages.at(-1).content[0]
      expect(call.name).toBe(name)
      expect(call.arguments).toMatchObject({ ...rawInput, ...normalized, __quickforgeAcp: { title: `ACP ${kind}`, kind } })
      expect(JSON.stringify(call)).not.toContain('secret')
    }

    agent.handleSessionUpdate({
      sessionId: 'acp-session',
      update: {
        sessionUpdate: 'tool_call', toolCallId: 'generic', title: 'Custom Action', kind: 'fetch',
        locations: [{ path: 'src/index.ts', line: 3, _meta: { secret: true } }], rawInput: { value: 1, _meta: { secret: true } },
      },
    })
    expect(agent.state.messages.at(-1).content[0]).toEqual({
      type: 'toolCall', id: 'generic', name: 'opencode_tool',
      arguments: { value: 1, path: 'src/index.ts', __quickforgeAcp: { title: 'Custom Action', kind: 'fetch', locations: [{ path: 'src/index.ts', line: 3 }] } },
    })
  })

  it('converts ACP content, diff and terminal summaries into bounded tool details', () => {
    const agent = createAgent()
    agent.handleSessionUpdate({ sessionId: 'acp-session', update: { sessionUpdate: 'tool_call', toolCallId: 'edit', title: 'Patch', kind: 'edit', rawInput: { file_path: 'a.txt' } } })
    agent.handleSessionUpdate({
      sessionId: 'acp-session',
      update: {
        sessionUpdate: 'tool_call_update', toolCallId: 'edit', status: 'failed', title: 'Patch failed', kind: 'edit',
        content: [
          { type: 'content', content: { type: 'text', text: 'failed output', _meta: { secret: true } } },
          { type: 'content', content: { type: 'resource', resource: { uri: 'quickforge://result', mimeType: 'text/plain', text: 'resource output', _meta: { secret: true } } } },
          { type: 'content', content: { type: 'resource', resource: { uri: 'quickforge://binary', mimeType: 'application/octet-stream', blob: 'AAEC' } } },
          { type: 'diff', path: 'a.txt', oldText: 'old', newText: 'new', _meta: { secret: true } },
          { type: 'terminal', terminalId: 'terminal-1', _meta: { secret: true } },
        ],
        rawOutput: { ignoredBecauseContentExists: true, _meta: { secret: true } },
        _meta: { secret: true },
      },
    })

    const result = agent.state.messages.at(-1)
    expect(result).toMatchObject({ toolCallId: 'edit', toolName: 'edit_file', isError: true })
    expect(result.content[0].text).toContain('resource output')
    expect(result.content[0].text).toContain('[binary resource: application/octet-stream, 4 base64 chars]')
    expect(result.content[0].text).toContain('[terminal: terminal-1]')
    expect(result.details).toMatchObject({
      __quickforgeAcp: { title: 'Patch failed', kind: 'edit' },
      diff: { format: 'unified', path: 'a.txt', addedLines: 1, removedLines: 1 },
    })
    expect(result.details.diff.text).toContain('-old')
    expect(result.details.diff.text).toContain('+new')
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it('bounds and sanitizes rawOutput when no structured ACP content is available', () => {
    const agent = createAgent()
    agent.handleSessionUpdate({ sessionId: 'acp-session', update: { sessionUpdate: 'tool_call', toolCallId: 'raw', title: 'Raw', kind: 'other', rawInput: {} } })
    agent.handleSessionUpdate({ sessionId: 'acp-session', update: { sessionUpdate: 'tool_call_update', toolCallId: 'raw', status: 'completed', rawOutput: { token: 'secret', payload: 'x'.repeat(20_000), _meta: { password: 'hidden' } } } })
    const text = agent.state.messages.at(-1).content[0].text
    expect(text.length).toBeLessThan(17_000)
    expect(text).toContain('[redacted]')
    expect(text).not.toContain('hidden')
  })

  it('does not create an orphan tool result or merge failed/multiple tools', () => {
    const agent = createAgent()
    agent.handleSessionUpdate({
      sessionId: 'acp-session',
      update: { sessionUpdate: 'tool_call_update', toolCallId: 'unknown', status: 'completed', rawOutput: 'ignored' },
    })
    for (const [id, status] of [['a', 'failed'], ['b', 'completed']]) {
      agent.handleSessionUpdate({ sessionId: 'acp-session', update: { sessionUpdate: 'tool_call', toolCallId: id, title: `tool-${id}`, rawInput: { id } } })
      agent.handleSessionUpdate({ sessionId: 'acp-session', update: { sessionUpdate: 'tool_call_update', toolCallId: id, status, rawOutput: id } })
    }

    expect(agent.state.messages.filter((message) => message.role === 'toolResult')).toEqual([
      expect.objectContaining({ toolCallId: 'a', isError: true }),
      expect.objectContaining({ toolCallId: 'b', isError: false }),
    ])
  })

  it('passes the permission callback result through unchanged', async () => {
    const result = { outcome: { outcome: 'selected', optionId: 'allow-once' } }
    const requestPermission = vi.fn(async () => result)
    const agent = createAgent({ requestPermission })

    await expect(agent.handlePermissionRequest({
      toolCall: { toolCallId: 'tool-1', title: 'Shell', rawInput: { command: 'npm test' } },
      options: [{ optionId: 'allow-once', kind: 'allow_once' }],
    })).resolves.toBe(result)
  })

  it('flushes and clears streaming state on abort', () => {
    const notify = vi.fn(async () => {})
    const agent = createAgent()
    agent.context = { notify }
    agent.state.isStreaming = true
    agent.abortController = new AbortController()
    textChunk(agent, 'message-1', 'partial')

    agent.abort()

    expect(agent.abortController.signal.aborted).toBe(true)
    expect(agent.state.isStreaming).toBe(false)
    expect(agent.state.streamingMessage).toBeUndefined()
    expect(agent.state.messages.at(-1)).toMatchObject({ content: [{ type: 'text', text: 'partial' }] })
  })

  it('ignores a late aborted prompt rejection after the next run starts', async () => {
    let rejectFirst
    const firstRequest = new Promise((_, reject) => { rejectFirst = reject })
    const request = vi.fn()
      .mockReturnValueOnce(firstRequest)
      .mockResolvedValueOnce({ stopReason: 'stop' })
    const agent = createAgent()
    agent.context = { request, notify: vi.fn(async () => {}) }

    const firstPrompt = agent.prompt('first').catch(() => {})
    agent.abort()
    await agent.prompt('second')
    rejectFirst(new Error('late cancel'))
    await firstPrompt

    expect(agent.state.errorMessage).toBeUndefined()
    expect(agent.state.messages.filter((message) => message.role === 'assistant' && message.stopReason === 'error')).toHaveLength(0)
  })

  it('sends image, text document, binary document, and attachment-only prompts as standard ACP blocks', async () => {
    const request = vi.fn(async () => ({ stopReason: 'stop' }))
    const agent = createAgent()
    agent.agentCapabilities = { promptCapabilities: { image: true, embeddedContext: true } }
    agent.context = { request }

    await agent.prompt({
      role: 'user-with-attachments', content: 'caption', timestamp: 1,
      attachments: [
        { id: 'image', type: 'image', fileName: 'image.png', mimeType: 'image/png', size: 3, content: 'AAEC', preview: 'data:image/png;base64,AAEC' },
        { id: 'text', type: 'document', fileName: 'notes.txt', mimeType: 'text/plain', size: 5, content: 'aGVsbG8=', extractedText: 'hello' },
        { id: 'binary', type: 'document', fileName: 'data.bin', mimeType: 'application/octet-stream', size: 3, content: 'AAEC' },
      ],
    })

    expect(request).toHaveBeenCalledWith('session/prompt', {
      sessionId: 'acp-session',
      prompt: [
        { type: 'text', text: 'caption' },
        { type: 'image', data: 'AAEC', mimeType: 'image/png' },
        { type: 'resource', resource: { uri: 'quickforge-attachment://prompt/2', mimeType: 'text/plain', text: 'hello' } },
        { type: 'resource', resource: { uri: 'quickforge-attachment://prompt/3', mimeType: 'application/octet-stream', blob: 'AAEC' } },
      ],
    })
    expect(JSON.stringify(request.mock.calls[0])).not.toContain('image.png')
    expect(JSON.stringify(request.mock.calls[0])).not.toContain('data.bin')

    request.mockClear()
    await agent.prompt({
      role: 'user-with-attachments', content: '', timestamp: 2,
      attachments: [{ id: 'only', type: 'image', fileName: 'only.png', mimeType: 'image/png', size: 3, content: 'AAEC' }],
    })
    expect(request.mock.calls[0][1].prompt).toEqual([{ type: 'image', data: 'AAEC', mimeType: 'image/png' }])
  })

  it.each([
    [{ promptCapabilities: { image: false, embeddedContext: true } }, { id: 'image', type: 'image', fileName: 'image.png', mimeType: 'image/png', size: 3, content: 'AAEC' }, 'OPENCODE_IMAGE_UNSUPPORTED'],
    [{ promptCapabilities: { image: true, embeddedContext: false } }, { id: 'doc', type: 'document', fileName: 'doc.txt', mimeType: 'text/plain', size: 4, content: 'dGVzdA==', extractedText: 'test' }, 'OPENCODE_EMBEDDED_CONTEXT_UNSUPPORTED'],
    [{ promptCapabilities: { image: true, embeddedContext: true } }, { id: 'bad', type: 'image', fileName: 'bad.png', mimeType: 'image/png', size: 3, content: 'not base64' }, 'OPENCODE_ATTACHMENT_INVALID'],
  ])('validates unsupported or invalid attachments synchronously', (agentCapabilities, attachment, errorCode) => {
    const agent = createAgent()
    agent.agentCapabilities = agentCapabilities

    expect(() => agent.validatePrompt({ role: 'user-with-attachments', content: '', timestamp: 1, attachments: [attachment] })).toThrow(expect.objectContaining({
      statusCode: 400,
      errorCode,
    }))
    expect(agent.state.messages).toEqual([])
    expect(agent.state.isStreaming).toBe(false)
  })

  it.each([
    [{ promptCapabilities: { image: false, embeddedContext: true } }, { id: 'image', type: 'image', fileName: 'image.png', mimeType: 'image/png', size: 3, content: 'AAEC' }, 'OPENCODE_IMAGE_UNSUPPORTED'],
    [{ promptCapabilities: { image: true, embeddedContext: false } }, { id: 'doc', type: 'document', fileName: 'doc.txt', mimeType: 'text/plain', size: 4, content: 'dGVzdA==', extractedText: 'test' }, 'OPENCODE_EMBEDDED_CONTEXT_UNSUPPORTED'],
    [{ promptCapabilities: { image: true, embeddedContext: true } }, { id: 'bad', type: 'image', fileName: 'bad.png', mimeType: 'image/png', size: 3, content: 'not base64' }, 'OPENCODE_ATTACHMENT_INVALID'],
  ])('rejects unsupported or invalid attachments before messages and agent_start', async (agentCapabilities, attachment, errorCode) => {
    const request = vi.fn()
    const agent = createAgent()
    const events = []
    agent.agentCapabilities = agentCapabilities
    agent.context = { request }
    agent.subscribe((event) => events.push(event))

    await expect(agent.prompt({ role: 'user-with-attachments', content: '', timestamp: 1, attachments: [attachment] })).rejects.toMatchObject({
      statusCode: 400,
      errorCode,
    })
    expect(request).not.toHaveBeenCalled()
    expect(agent.state.messages).toEqual([])
    expect(agent.state.isStreaming).toBe(false)
    expect(events).toEqual([])
  })
})

describe('OpenCode ACP dynamic session metadata', () => {
  const setupResult = {
    configOptions: [
      { id: 'model', name: 'Model', type: 'select', currentValue: 'a', options: [{ value: 'a', name: 'A', _meta: { secret: true } }], _meta: { token: 'secret' } },
      { id: 'enabled', name: 'Enabled', type: 'boolean', currentValue: true, unknown: 'drop' },
    ],
    modes: { currentModeId: 'build', availableModes: [{ id: 'build', name: 'Build', _meta: { secret: true } }], _meta: { secret: true } },
    _meta: { secret: true },
  }

  it('normalizes and applies setup config/modes without metadata', async () => {
    expect(normalizeOpenCodeSessionSetupResult(setupResult)).toEqual({
      configOptions: [
        { id: 'model', name: 'Model', type: 'select', currentValue: 'a', options: [{ value: 'a', name: 'A' }] },
        { id: 'enabled', name: 'Enabled', type: 'boolean', currentValue: true },
      ],
      modes: { currentModeId: 'build', availableModes: [{ id: 'build', name: 'Build' }] },
    })

    const agent = createAgent()
    agent.agentCapabilities = { loadSession: true }
    agent.context = { request: vi.fn(async () => setupResult) }
    await agent.loadExistingSession()
    expect(agent.state.acpSession).toMatchObject(normalizeOpenCodeSessionSetupResult(setupResult))
  })

  it('buffers only setup metadata updates and does not duplicate message history', () => {
    const agent = createAgent()
    agent.initialized = true
    agent.acceptUpdates = false
    agent.handleSessionUpdate({ sessionId: 'acp-session', update: { sessionUpdate: 'agent_message_chunk', messageId: 'history', content: { type: 'text', text: 'duplicate' } } })
    agent.handleSessionUpdate({ sessionId: 'acp-session', update: { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'help', description: 'Help', _meta: { secret: true } }] } })
    agent.handleSessionUpdate({ sessionId: 'other', update: { sessionUpdate: 'usage_update', used: 99, size: 100 } })
    agent.acceptUpdates = true
    agent.flushSetupMetadataBuffer()

    expect(agent.state.messages).toEqual([])
    expect(agent.state.acpSession.availableCommands).toEqual([{ name: 'help', description: 'Help' }])
    expect(agent.state.acpSession.usage).toBeNull()
  })

  it('stores all five metadata updates, ignores wrong sessions, and keeps title/usage separate', () => {
    const agent = createAgent()
    const title = 'QuickForge title'
    agent.handleSessionUpdate({ sessionId: 'acp-session', update: { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'run', description: 'Run', input: { hint: 'args', _meta: { secret: true } } }] } })
    agent.handleSessionUpdate({ sessionId: 'acp-session', update: { sessionUpdate: 'current_mode_update', currentModeId: 'plan' } })
    agent.handleSessionUpdate({ sessionId: 'acp-session', update: { sessionUpdate: 'config_option_update', configOptions: setupResult.configOptions } })
    agent.handleSessionUpdate({ sessionId: 'acp-session', update: { sessionUpdate: 'session_info_update', title: 'ACP title', updatedAt: '2026-01-01T00:00:00Z', _meta: { secret: true } } })
    agent.handleSessionUpdate({ sessionId: 'acp-session', update: { sessionUpdate: 'usage_update', used: 12, size: 100, cost: { amount: 1.5, currency: 'USD', _meta: { secret: true } } } })
    agent.handleSessionUpdate({ sessionId: 'wrong', update: { sessionUpdate: 'usage_update', used: 99, size: 100 } })

    expect(title).toBe('QuickForge title')
    expect(agent.state.acpSession).toEqual({
      configOptions: normalizeOpenCodeSessionSetupResult(setupResult).configOptions,
      modes: { currentModeId: 'plan', availableModes: [] },
      availableCommands: [{ name: 'run', description: 'Run', input: { hint: 'args' } }],
      sessionInfo: { title: 'ACP title', updatedAt: '2026-01-01T00:00:00Z' },
      usage: { used: 12, size: 100, cost: { amount: 1.5, currency: 'USD' } },
    })
    expect(agent.state.contextUsage).toBeUndefined()
  })

  it('validates config setters, sends boolean type, and writes back the full response', async () => {
    const agent = createAgent()
    agent.applySessionSetupResult(setupResult)
    const responseOptions = [{ id: 'enabled', name: 'Enabled', type: 'boolean', currentValue: false, _meta: { secret: true } }]
    agent.context = { request: vi.fn(async () => ({ configOptions: responseOptions, _meta: { secret: true } })) }

    await agent.setConfigOption('enabled', false)
    expect(agent.context.request).toHaveBeenCalledWith('session/set_config_option', {
      sessionId: 'acp-session', configId: 'enabled', value: false, type: 'boolean',
    })
    expect(agent.state.acpSession.configOptions).toEqual([{ id: 'enabled', name: 'Enabled', type: 'boolean', currentValue: false }])
    await expect(agent.setConfigOption('missing', true)).rejects.toMatchObject({ statusCode: 400 })
  })

  it('validates modes, forbids streaming, and updates the current mode after success', async () => {
    const agent = createAgent()
    agent.applySessionSetupResult(setupResult)
    agent.state.acpSession.modes.availableModes.push({ id: 'plan', name: 'Plan' })
    agent.context = { request: vi.fn(async () => ({})) }

    await agent.setMode('plan')
    expect(agent.context.request).toHaveBeenCalledWith('session/set_mode', { sessionId: 'acp-session', modeId: 'plan' })
    expect(agent.state.acpSession.modes.currentModeId).toBe('plan')
    agent.state.isStreaming = true
    await expect(agent.setMode('build')).rejects.toMatchObject({ statusCode: 409 })
  })

  it('carries the ACP fork source and restored usage snapshot into the initial acpSession', () => {
    const agent = new OpenCodeAcpAgent({
      sessionId: 'quickforge-session',
      cwd: process.cwd(),
      messages: [],
      harnessSessionId: null,
      sourceHarnessSessionId: 'source-acp-session',
      restoredUsage: { used: 12, size: 100, cost: { amount: 1.5, currency: 'USD', _meta: { secret: true } } },
      requestPermission: undefined,
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    })
    agent.acceptUpdates = true
    expect(agent.harnessSessionId).toBeNull()
    expect(agent.sourceHarnessSessionId).toBe('source-acp-session')
    // The usage snapshot is sanitized (no _meta) and refilled so the badge shows
    // before the next usage_update arrives; config/modes stay runtime-authoritative.
    expect(agent.state.acpSession).toMatchObject({
      configOptions: [],
      modes: null,
      usage: { used: 12, size: 100, cost: { amount: 1.5, currency: 'USD' } },
    })
  })
})

describe('OpenCode ACP deadlines and diagnostics', () => {
  it('turns a prompt deadline into one fatal runtime failure and ignores late updates', async () => {
    const terminateProcessTree = vi.fn(async () => {})
    const connection = { close: vi.fn() }
    const agent = createAgent({
      dependencies: {
        terminateProcessTree,
        setTimer: (callback) => { queueMicrotask(callback); return { unref() {} } },
        clearTimer: () => {},
      },
    })
    const events = []
    agent.connection = connection
    agent.process = { pid: 42, exitCode: null, signalCode: null }
    agent.context = { request: vi.fn(() => new Promise(() => {})) }
    agent.subscribe((event) => events.push(event))

    const prompt = agent.prompt('hello')
    await expect(prompt).rejects.toMatchObject({
      statusCode: 504,
      errorCode: 'OPENCODE_ACP_TIMEOUT',
      stage: 'session/prompt',
    })
    await agent.runtimeTerminationPromise

    expect(agent.acceptUpdates).toBe(false)
    expect(connection.close).toHaveBeenCalledOnce()
    expect(terminateProcessTree).toHaveBeenCalledOnce()
    expect(events.filter((event) => event.type === 'error')).toHaveLength(1)
    expect(events.filter((event) => event.type === 'agent_end')).toHaveLength(1)

    const messageCount = agent.state.messages.length
    textChunk(agent, 'late-message', 'late')
    expect(agent.state.messages).toHaveLength(messageCount)
    await expect(agent.prompt('next')).rejects.toMatchObject({ errorCode: 'OPENCODE_ACP_TIMEOUT' })
  })

  it('can make a close deadline non-fatal', async () => {
    const agent = createAgent({
      dependencies: {
        setTimer: (callback) => { queueMicrotask(callback); return { unref() {} } },
        clearTimer: () => {},
      },
    })

    await expect(agent.requestWithDeadline('session/close', 1, () => new Promise(() => {}), { fatal: false })).rejects.toMatchObject({
      errorCode: 'OPENCODE_ACP_TIMEOUT',
    })
    expect(agent.runtimeFailure).toBeNull()
    expect(agent.acceptUpdates).toBe(true)
  })

  it('returns a stage-specific timeout without fake timers', async () => {
    const agent = createAgent({
      dependencies: {
        setTimer: (callback) => { queueMicrotask(callback); return { unref() {} } },
        clearTimer: () => {},
      },
    })
    await expect(agent.requestWithDeadline('session/prompt', 5, () => new Promise(() => {}))).rejects.toMatchObject({
      statusCode: 504,
      errorCode: 'OPENCODE_ACP_TIMEOUT',
      stage: 'session/prompt',
    })
  })

  it('maps ACP auth required and does not expose data/meta diagnostics', async () => {
    const agent = createAgent()
    await expect(agent.requestWithDeadline('session/new', 100, () => Promise.reject(Object.assign(new Error('login required'), {
      code: -32000,
      data: { token: 'secret' },
      _meta: { password: 'secret' },
    })))).rejects.toMatchObject({ statusCode: 401, errorCode: 'OPENCODE_AUTH_REQUIRED' })
  })

  it('validates protocol and lifecycle capabilities before requests', async () => {
    const agent = createAgent()
    expect(() => agent.validateInitializeResult({ protocolVersion: -1 })).toThrow(expect.objectContaining({ errorCode: 'OPENCODE_ACP_INCOMPATIBLE' }))
    agent.validateInitializeResult({ protocolVersion: 1, agentCapabilities: { sessionCapabilities: { resume: {} } }, authMethods: [], agentInfo: { name: 'OpenCode', version: '1' } })
    agent.context = { request: vi.fn(async () => ({})) }
    await agent.loadExistingSession()
    expect(agent.context.request).toHaveBeenCalledTimes(1)
  })

  it('redacts secrets, URLs, private keys and local paths', () => {
    const diagnostic = sanitizeOpenCodeDiagnostic('Bearer abc token=123 https://example.test C:\\Users\\name\\secret -----BEGIN PRIVATE KEY----- abc -----END PRIVATE KEY-----')
    expect(diagnostic).not.toContain('abc')
    expect(diagnostic).not.toContain('example.test')
    expect(diagnostic).not.toContain('Users')
    expect(diagnostic).toContain('[redacted]')
  })
})

describe('OpenCode ACP runtime failure and disposal', () => {
  it('handles process failure once while streaming and fails the next prompt immediately', async () => {
    const agent = createAgent()
    const events = []
    agent.subscribe((event) => events.push(event))
    agent.state.isStreaming = true
    textChunk(agent, 'message-1', 'partial')

    agent.handleRuntimeFailure(new Error('Bearer secret https://host/path'), 'process')
    agent.handleRuntimeFailure(new Error('second'), 'process')

    expect(events.filter((event) => event.type === 'error')).toHaveLength(1)
    expect(events.filter((event) => event.type === 'agent_end')).toHaveLength(1)
    await expect(agent.prompt('next')).rejects.toMatchObject({ errorCode: 'OPENCODE_ACP_RUNTIME_ERROR' })
  })

  it('kills the process tree even when close times out', async () => {
    const child = new EventEmitter()
    child.pid = 42
    child.exitCode = null
    child.signalCode = null
    const terminateProcessTree = vi.fn(async () => {})
    const agent = createAgent({
      timeouts: { close: 1 },
      dependencies: {
        terminateProcessTree,
        setTimer: (callback) => { queueMicrotask(callback); return { unref() {} } },
        clearTimer: () => {},
      },
    })
    agent.process = child
    agent.agentCapabilities = { sessionCapabilities: { close: {} } }
    agent.context = { request: vi.fn(() => new Promise(() => {})) }
    agent.connection = { close: vi.fn() }

    await agent.dispose()

    expect(agent.connection.close).toHaveBeenCalledOnce()
    expect(terminateProcessTree).toHaveBeenCalledWith(child)
  })
})
