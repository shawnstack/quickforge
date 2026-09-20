import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { executeHook, substituteVariables } from '../../../server/hooks/hook-executor.mjs'

function commandHook(command, overrides = {}) {
  return {
    id: 'hook-1',
    name: 'Test hook',
    enabled: true,
    events: ['agent_start'],
    action: { type: 'command', command },
    timeoutSeconds: 10,
    silentOnFailure: false,
    ...overrides,
  }
}

function webhookHook(actionOverrides = {}, overrides = {}) {
  return {
    id: 'hook-web',
    name: 'Webhook hook',
    enabled: true,
    events: ['agent_start'],
    action: { type: 'webhook', url: 'http://127.0.0.1:9/example', method: 'POST', ...actionOverrides },
    timeoutSeconds: 10,
    silentOnFailure: false,
    ...overrides,
  }
}

const baseCtx = {
  event: 'agent_start',
  sessionId: 'session-1',
  project: 'demo',
  projectPath: 'D:/work/demo',
  toolName: 'read_file',
  message: 'hello',
}

describe('substituteVariables', () => {
  it('replaces every known variable', () => {
    expect(substituteVariables('{{event}}|{{session.id}}|{{session.project}}|{{session.projectPath}}|{{tool.name}}|{{message}}', baseCtx))
      .toBe('agent_start|session-1|demo|D:/work/demo|read_file|hello')
  })

  it('resolves unknown and missing variables to an empty string', () => {
    expect(substituteVariables('a={{unknown}} b={{session.id}} c={{missing.key}}', { sessionId: 's1' })).toBe('a= b=s1 c=')
    expect(substituteVariables('{{event}}', {})).toBe('')
  })

  it('returns an empty string for non-string templates and tolerates whitespace', () => {
    expect(substituteVariables(null)).toBe('')
    expect(substituteVariables(42)).toBe('')
    expect(substituteVariables('{{ event }}', { event: 'x' })).toBe('x')
  })
})

describe('executeHook command action', () => {
  it('reports success with merged stdout output and exit code 0', async () => {
    const record = await executeHook(commandHook('node -e "process.stdout.write(\'out\'); process.stderr.write(\'err\')"'), baseCtx)
    expect(record.status).toBe('success')
    expect(record.exitCode).toBe(0)
    expect(record.output).toContain('out')
    expect(record.output).toContain('err')
    expect(record.event).toBe('agent_start')
    expect(record.hookId).toBe('hook-1')
    expect(typeof record.startedAt).toBe('string')
    expect(record.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('reports a non-zero exit as an error record', async () => {
    const record = await executeHook(commandHook('node -e "process.exit(3)"'), baseCtx)
    expect(record.status).toBe('error')
    expect(record.exitCode).toBe(3)
  })

  it('terminates a long-running command on timeout', async () => {
    const record = await executeHook(commandHook('node -e "setInterval(() => {}, 1000)"', { timeoutSeconds: 1 }), baseCtx)
    expect(record.status).toBe('timeout')
    expect(record.hookId).toBe('hook-1')
  }, 20_000)

  it('honors the shared 300-second upper timeout limit', async () => {
    const realSetTimeout = globalThis.setTimeout
    const delays = []
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn, delay, ...args) => {
      delays.push(delay)
      return realSetTimeout(fn, delay, ...args)
    })
    try {
      const record = await executeHook(
        commandHook('node -e "process.stdout.write(\'ok\')"', { timeoutSeconds: 300 }),
        baseCtx,
      )
      expect(record.status).toBe('success')
      expect(record.output).toContain('ok')
      expect(delays).toContain(300_000)
    } finally {
      setTimeoutSpy.mockRestore()
    }
  })

  it('truncates captured output to the 4000-character tail', async () => {
    const record = await executeHook(commandHook('node -e "process.stdout.write(\'A\'.repeat(9500) + \'END\')"'), baseCtx)
    expect(record.output.length).toBe(4000)
    expect(record.output.endsWith('END')).toBe(true)
  })

  it('substitutes variables into the command line', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qf-hook-exec-'))
    try {
      const marker = path.join(dir, 'marker.txt').replace(/\\/g, '/')
      const record = await executeHook(
        commandHook('node -e "require(\'fs\').writeFileSync(process.argv[1], \'written\')" "{{session.projectPath}}"'),
        { ...baseCtx, projectPath: marker },
      )
      expect(record.status).toBe('success')
      await expect(fs.readFile(marker, 'utf8')).resolves.toBe('written')
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it('never throws and records an error for an unusable hook', async () => {
    const record = await executeHook({ id: 'broken', name: 'Broken' }, baseCtx)
    expect(record.status).toBe('error')
    expect(record.output).toBe('Invalid hook action')
  })
})

describe('executeHook webhook action', () => {
  it('POSTs the default JSON body with a JSON content type', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, text: async () => 'ok text' })
    try {
      const record = await executeHook(webhookHook({ url: 'http://127.0.0.1:9/hook?x={{event}}' }), baseCtx)
      expect(record.status).toBe('success')
      expect(record.httpStatus).toBe(200)
      expect(record.output).toBe('ok text')

      const [url, init] = fetchSpy.mock.calls[0]
      expect(url).toBe('http://127.0.0.1:9/hook?x=agent_start')
      expect(init.method).toBe('POST')
      expect(init.headers['content-type']).toBe('application/json')
      expect(JSON.parse(init.body)).toMatchObject({
        event: 'agent_start',
        sessionId: 'session-1',
        project: 'demo',
        tool: 'read_file',
        message: 'hello',
      })
      expect(typeof JSON.parse(init.body).at).toBe('string')
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('sends a substituted custom header and body template', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 204, text: async () => '' })
    try {
      const record = await executeHook(webhookHook({
        headers: [{ name: 'x-token', value: 't-{{event}}' }, { name: '  ', value: 'dropped' }],
        bodyTemplate: 'evt={{event}} tool={{tool.name}}',
      }), baseCtx)
      expect(record.status).toBe('success')

      const [, init] = fetchSpy.mock.calls[0]
      expect(init.headers['x-token']).toBe('t-agent_start')
      expect('  ' in init.headers).toBe(false)
      expect(init.body).toBe('evt=agent_start tool=read_file')
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('sends no body for GET requests', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, text: async () => '' })
    try {
      await executeHook(webhookHook({ method: 'GET' }), baseCtx)
      const [, init] = fetchSpy.mock.calls[0]
      expect(init.method).toBe('GET')
      expect(init.body).toBeUndefined()
      expect(init.headers['content-type']).toBeUndefined()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('records non-2xx responses as errors with the HTTP status', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 503, text: async () => 'server exploded' })
    try {
      const record = await executeHook(webhookHook(), baseCtx)
      expect(record.status).toBe('error')
      expect(record.httpStatus).toBe(503)
      expect(record.output).toBe('server exploded')
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('maps an aborted request to a timeout record', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        const error = new Error('The operation was aborted')
        error.name = 'AbortError'
        reject(error)
      })
    }))
    try {
      const record = await executeHook(webhookHook({}, { timeoutSeconds: 1 }), baseCtx)
      expect(record.status).toBe('timeout')
      expect(record.httpStatus).toBeUndefined()
    } finally {
      fetchSpy.mockRestore()
    }
  }, 20_000)

  it('records network failures as errors without throwing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'))
    try {
      const record = await executeHook(webhookHook(), baseCtx)
      expect(record.status).toBe('error')
      expect(record.output).toBe('fetch failed')
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
