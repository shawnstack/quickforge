import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// promptApiKey mounts through an imperative createRoot; mock it (same pattern
// as confirm-dialog.test.ts) so the dialog wiring can be inspected in Node.
const { roots } = vi.hoisted(() => {
  const roots: Array<{ container: unknown; element: unknown; unmounted: boolean }> = []
  return { roots }
})

vi.mock('react-dom/client', () => ({
  createRoot: (container: unknown) => {
    const root = { container, element: null as unknown, unmounted: false }
    roots.push(root)
    return {
      render: (element: unknown) => {
        root.element = element
      },
      unmount: () => {
        root.unmounted = true
      },
    }
  },
}))

import { processToolGroupDefaultExpanded } from '../../src/components/chat/panel-decoration/process-folding'
import { applyAppLanguageFromSnapshot, t } from '../../src/lib/i18n'
import {
  ApiKeyPromptDialog,
  isDialogEscapeKey,
  promptApiKey,
  saveApiKeyWithVerification,
  startApiKeyPolling,
  verifyApiKeyBeforeSave,
} from '../../src/components/chat/surface/ApiKeyPromptDialog'
import { setAppStorage, type AppStorage } from '../../src/storage'

type DialogElement = {
  props: {
    provider: string
    getKey: (provider: string) => Promise<string | null>
    saveKey: (provider: string, key: string) => Promise<void>
    onResolve: (success: boolean) => void
  }
}

function lastRenderedDialog(): DialogElement {
  const root = roots[roots.length - 1]
  if (!root?.element) throw new Error('promptApiKey did not render a dialog')
  return root.element as DialogElement
}

class FakeElement {
  tag: string
  removed = false
  focusCalls = 0
  isConnected = true
  constructor(tag: string) {
    this.tag = tag
  }
  remove() {
    this.removed = true
  }
  focus() {
    this.focusCalls++
  }
}

let appendedContainers: FakeElement[]
// Element focused before `promptApiKey` opened; the prompt must focus it again
// when it closes (legacy modal base did the same).
let previouslyFocused: FakeElement

function stubDocument() {
  appendedContainers = []
  previouslyFocused = new FakeElement('button')
  vi.stubGlobal('document', {
    documentElement: { lang: '', dir: '' },
    createElement: (tag: string) => new FakeElement(tag),
    get activeElement() {
      return previouslyFocused
    },
    body: {
      appendChild: (element: FakeElement) => {
        appendedContainers.push(element)
        return element
      },
    },
  })
  // `promptApiKey` records `document.activeElement` behind an `instanceof
  // HTMLElement` check (same as confirm-dialog.tsx), so the class must exist in
  // the Node test environment too.
  vi.stubGlobal('HTMLElement', FakeElement)
}

/**
 * Stub the app storage with locally configured custom providers. These are the
 * objects `verifyApiKeyBeforeSave` must prefer, because they keep the custom
 * request `headers` that the server-side model catalog strips.
 */
function stubCustomProviders(providers: unknown[]) {
  setAppStorage({
    providerKeys: {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {}),
    },
    customProviders: {
      getAll: vi.fn(async () => providers),
    },
  } as unknown as AppStorage)
}

beforeEach(() => {
  // Surface copy comes from i18n (language falls back to navigator.language).
  applyAppLanguageFromSnapshot('en')
  roots.length = 0
  stubDocument()
  setAppStorage({
    providerKeys: {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {}),
    },
  } as unknown as AppStorage)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('startApiKeyPolling', () => {
  it('calls onFound once the key appears in the store', async () => {
    vi.useFakeTimers()
    let reads = 0
    const getKey = vi.fn(async () => {
      reads += 1
      return reads >= 3 ? 'sk-123' : null
    })
    const onFound = vi.fn()

    startApiKeyPolling({ provider: 'anthropic', getKey, intervalMs: 500, onFound })
    await vi.advanceTimersByTimeAsync(1500)

    expect(onFound).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('keeps polling after a failed store read and stops via the stop function', async () => {
    vi.useFakeTimers()
    const getKey = vi
      .fn<(provider: string) => Promise<string | null>>()
      .mockRejectedValueOnce(new Error('store unavailable'))
      .mockResolvedValue('sk-123')
    const onFound = vi.fn()

    startApiKeyPolling({ provider: 'anthropic', getKey, intervalMs: 100, onFound })
    await vi.advanceTimersByTimeAsync(250)
    expect(onFound).toHaveBeenCalledTimes(1)

    // A fresh poller stopped before finding anything never fires onFound.
    const onFound2 = vi.fn()
    const stop2 = startApiKeyPolling({
      provider: 'openai',
      getKey: vi.fn(async () => 'sk-456'),
      intervalMs: 100,
      onFound: onFound2,
    })
    stop2()
    await vi.advanceTimersByTimeAsync(500)
    expect(onFound2).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})

describe('isDialogEscapeKey', () => {
  it('matches a bare Escape only', () => {
    expect(isDialogEscapeKey({ key: 'Escape' } as KeyboardEvent)).toBe(true)
    expect(isDialogEscapeKey({ key: 'Enter' } as KeyboardEvent)).toBe(false)
    expect(isDialogEscapeKey({ key: 'Escape', ctrlKey: true } as KeyboardEvent)).toBe(false)
    expect(isDialogEscapeKey({ key: 'Escape', metaKey: true } as KeyboardEvent)).toBe(false)
  })
})

describe('promptApiKey', () => {
  it('renders the dialog for the provider and resolves false on dismiss', async () => {
    const promise = promptApiKey('anthropic')

    expect(appendedContainers).toHaveLength(1)
    const dialog = lastRenderedDialog()
    expect(dialog.props.provider).toBe('anthropic')

    dialog.props.onResolve(false)
    await expect(promise).resolves.toBe(false)

    expect(roots[roots.length - 1].unmounted).toBe(true)
    expect(appendedContainers[0].removed).toBe(true)
  })

  it('resolves true when the dialog reports the key was stored', async () => {
    const promise = promptApiKey('openai')

    const dialog = lastRenderedDialog()
    // saveKey writes to the local store (wired to getAppStorage()).
    await dialog.props.saveKey('openai', 'sk-test')
    dialog.props.onResolve(true)

    await expect(promise).resolves.toBe(true)
  })
})

describe('ApiKeyPromptDialog rendering', () => {
  it('shows the provider and a password input', () => {
    const markup = renderToStaticMarkup(
      createElement(ApiKeyPromptDialog, {
        provider: 'anthropic',
        getKey: async () => null,
        saveKey: async () => {},
        onResolve: () => {},
      }),
    )

    expect(markup).toContain('qf-api-key-prompt-dialog')
    expect(markup).toContain('API Key Required')
    expect(markup).toContain('anthropic')
    expect(markup).toContain('type="password"')
    expect(markup).toContain('Enter API key')
    expect(markup).toContain('Save')
    expect(markup).toContain('Cancel')

    applyAppLanguageFromSnapshot('zh')
    const zhMarkup = renderToStaticMarkup(
      createElement(ApiKeyPromptDialog, {
        provider: 'anthropic',
        getKey: async () => null,
        saveKey: async () => {},
        onResolve: () => {},
      }),
    )
    expect(zhMarkup).toContain('需要 API Key')
    expect(zhMarkup).toContain('保存')
    expect(zhMarkup).toContain('取消')
  })
})

describe('verifyApiKeyBeforeSave', () => {
  const anthropicModel = {
    id: 'claude-3-5-sonnet',
    provider: 'anthropic',
    api: 'anthropic-messages',
    baseUrl: 'https://api.anthropic.com',
  }

  function stubFetchRoutes(routes: { catalog?: unknown; testConnection?: unknown }) {
    const fetchMock = vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
      const url = String(input)
      if (url.startsWith('/api/models/catalog')) {
        return { ok: true, json: async () => ({ models: routes.catalog ?? [] }) }
      }
      if (url === '/api/models/test-connection') {
        if (init?.method !== 'POST') throw new Error(`unexpected probe method: ${String(init?.method)}`)
        return { ok: true, json: async () => routes.testConnection ?? { ok: true } }
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('probes the provider model server-side and rejects a bad key', async () => {
    const fetchMock = stubFetchRoutes({
      catalog: [anthropicModel],
      testConnection: { ok: false, error: 'invalid api key' },
    })

    await expect(verifyApiKeyBeforeSave('anthropic', 'sk-bad')).resolves.toBe(false)

    const probe = fetchMock.mock.calls.find(([input]) => String(input) === '/api/models/test-connection')
    expect(probe).toBeTruthy()
    expect(probe?.[1]?.method).toBe('POST')
    expect(JSON.parse(String(probe?.[1]?.body))).toMatchObject({ model: anthropicModel, apiKey: 'sk-bad' })
  })

  it('accepts the key when the probe answers ok:true', async () => {
    stubFetchRoutes({ catalog: [anthropicModel], testConnection: { ok: true } })
    await expect(verifyApiKeyBeforeSave('anthropic', 'sk-good')).resolves.toBe(true)
  })

  it('probes with the locally configured model so custom headers survive the catalog', async () => {
    const localModel = {
      ...anthropicModel,
      provider: 'My Gateway',
      headers: { 'X-Org': 'quickforge' },
    }
    stubCustomProviders([
      {
        id: 'provider-1',
        name: 'My Gateway',
        type: 'openai-completions',
        baseUrl: 'https://gateway.example/v1',
        models: [localModel],
      },
    ])
    const fetchMock = stubFetchRoutes({
      // The catalog entry for the same provider carries no `headers` (the
      // server's `publicModel()` strips them), so probing it would always fail
      // for a provider that needs custom request headers.
      catalog: [{ ...anthropicModel, provider: 'My Gateway' }],
      testConnection: { ok: true },
    })

    await expect(verifyApiKeyBeforeSave('My Gateway', 'sk-good')).resolves.toBe(true)

    const probe = fetchMock.mock.calls.find(([input]) => String(input) === '/api/models/test-connection')
    expect(JSON.parse(String(probe?.[1]?.body))).toMatchObject({
      model: { provider: 'My Gateway', headers: { 'X-Org': 'quickforge' } },
      apiKey: 'sk-good',
    })
  })

  it('skips the probe when the catalog has no model for the provider', async () => {
    const fetchMock = stubFetchRoutes({
      catalog: [
        { id: 'anything', provider: 'openrouter', api: 'openai-completions', baseUrl: 'https://openrouter.ai/api/v1' },
      ],
    })

    await expect(verifyApiKeyBeforeSave('anthropic', 'sk-any')).resolves.toBe(true)
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(['/api/models/catalog'])
  })

  it('treats transport errors as a failed test', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )

    await expect(verifyApiKeyBeforeSave('anthropic', 'sk-any')).resolves.toBe(false)
  })
})

describe('saveApiKeyWithVerification', () => {
  it('does not write the key to the provider-keys store when the probe rejects it', async () => {
    const saveKey = vi.fn(async () => {})

    const outcome = await saveApiKeyWithVerification({
      provider: 'anthropic',
      apiKey: 'sk-bad',
      saveKey,
      verify: async () => false,
    })

    expect(outcome).toEqual({ status: 'invalid' })
    expect(saveKey).not.toHaveBeenCalled()
  })

  it('writes the key once the probe accepts it', async () => {
    const saveKey = vi.fn(async () => {})

    const outcome = await saveApiKeyWithVerification({
      provider: 'anthropic',
      apiKey: 'sk-good',
      saveKey,
      verify: async () => true,
    })

    expect(outcome).toEqual({ status: 'saved' })
    expect(saveKey).toHaveBeenCalledWith('anthropic', 'sk-good')
  })

  it('surfaces store failures instead of rejecting', async () => {
    const outcome = await saveApiKeyWithVerification({
      provider: 'anthropic',
      apiKey: 'sk-good',
      saveKey: async () => {
        throw new Error('quota exceeded')
      },
      verify: async () => true,
    })

    expect(outcome).toEqual({ status: 'failed', error: 'Error: quota exceeded' })
  })
})

describe('promptApiKey focus handling', () => {
  it('restores focus to the element focused before opening once the prompt closes', async () => {
    vi.useFakeTimers()

    const promise = promptApiKey('anthropic')
    lastRenderedDialog().props.onResolve(true)
    await expect(promise).resolves.toBe(true)

    // Focus restore is deferred one macrotask (confirm-dialog.tsx pattern).
    expect(previouslyFocused.focusCalls).toBe(0)
    vi.advanceTimersByTime(1)
    expect(previouslyFocused.focusCalls).toBe(1)
    vi.useRealTimers()
  })

  it('does not restore focus when the previous element is detached', async () => {
    vi.useFakeTimers()

    const promise = promptApiKey('anthropic')
    previouslyFocused.isConnected = false
    lastRenderedDialog().props.onResolve(false)
    await expect(promise).resolves.toBe(false)

    vi.advanceTimersByTime(1)
    expect(previouslyFocused.focusCalls).toBe(0)
    vi.useRealTimers()
  })
})

describe('dialog Invalid-state contract', () => {
  const source = readFileSync(
    new URL('../../src/components/chat/surface/ApiKeyPromptDialog.tsx', import.meta.url),
    'utf8',
  )

  it('keeps the legacy test-before-store flow', () => {
    expect(source).toContain('saveApiKeyWithVerification')
    expect(source).toContain('verifyApiKeyBeforeSave')
  })

  it('shows ✗ Invalid for 5s and Testing... while the probe runs', () => {
    expect(source).toContain("t('apiKeyPromptInvalid')")
    expect(source).toContain('5000')
    expect(source).toContain("t('testingConnection')")
  })

  it('carries the ✗ Invalid copy for en and zh', () => {
    expect(t('apiKeyPromptInvalid')).toBe('✗ Invalid')
    applyAppLanguageFromSnapshot('zh')
    expect(t('apiKeyPromptInvalid')).toBe('✗ 无效')
  })
})

describe('tool display mode copy', () => {
  it('describes the tool-group defaults that process-folding actually applies', () => {
    // `process-folding` collapses tool groups in compact mode and expands them
    // in detailed mode, so the settings copy must not promise "expanded in both
    // modes".
    expect(processToolGroupDefaultExpanded('compact')).toBe(false)
    expect(processToolGroupDefaultExpanded('detailed')).toBe(true)

    expect(t('toolDisplayModeDescription')).toBe(
      'Compact shows summaries with details collapsed. Detailed shows full parameters and details with tool calls expanded.',
    )
    expect(t('toolDisplayModeDescription')).not.toContain('expanded by default in both modes')

    applyAppLanguageFromSnapshot('zh')
    expect(t('toolDisplayModeDescription')).toBe(
      '简洁模式显示摘要并默认收起详情；详细模式显示完整参数和 details，并默认展开 Tool 调用。',
    )
    expect(t('toolDisplayModeDescription')).not.toContain('两种模式下工具调用组均默认展开')
  })
})
