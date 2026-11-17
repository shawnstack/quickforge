import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { harness, nodes, text } from './settings-react-harness'

vi.mock('react', async (original) => ({ ...(await original<typeof import('react')>()), ...(await import('./settings-react-harness')).hooks }))

import { ApiKeyPromptDialog } from '../../src/components/chat/surface/ApiKeyPromptDialog'
import { applyAppLanguageFromSnapshot } from '../../src/lib/i18n'
import { setAppStorage, type AppStorage } from '../../src/storage'

// 保存流程会走 verifyApiKeyBeforeSave → resolveProbeModel：本地 provider 为空、
// 目录里也没有该 provider 的 model 时直接放行，让失败落在 saveKey 上——这正是
// `apiKeyPromptSaveFailed` 那条错误的生产路径。
beforeEach(() => {
  harness.reset()
  applyAppLanguageFromSnapshot('en')
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ models: [] }) })))
  setAppStorage({ customProviders: { getAll: async () => [] } } as unknown as AppStorage)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function render() {
  harness.begin()
  return nodes(
    ApiKeyPromptDialog({
      provider: 'acme',
      getKey: async () => null,
      saveKey: async () => {
        throw new Error('boom')
      },
      onResolve: () => {},
    }),
  )
}

const hasText = (value: string) => render().some((node) => text(node).includes(value))

function typeKey(value: string) {
  // `<Input>` 是 ui 组件，harness 不执行子组件：按 props 上的 onKeyDown/onChange 定位元素。
  render().find((node) => typeof node.props.onKeyDown === 'function')!.props.onChange({ currentTarget: { value } })
}

function clickSave() {
  // `<Button>` 同为 ui 组件：定位有 onClick 回调且文案为 Save 的那个节点。
  render().find((node) => typeof node.props.onClick === 'function' && text(node) === 'Save')!.props.onClick()
}

// 错误态只存键、渲染侧现取译文：错误显示后用户切语言，错误句必须跟着换。
// 反例（旧实现）是把 `t(...)` 的渲染结果冻结进 state——切语言后仍是旧语言的句子。
describe('ApiKeyPromptDialog 错误文案跟随语言切换', () => {
  it('保存失败后切语言，错误句跟着换成新语言', async () => {
    typeKey('sk-test')
    clickSave()

    await vi.waitFor(() => expect(hasText('Failed to save API key: Error: boom')).toBe(true))

    applyAppLanguageFromSnapshot('zh')
    expect(hasText('保存 API Key 失败：Error: boom')).toBe(true)
    expect(hasText('Failed to save API key')).toBe(false)
  })

  it('无效 Key 的提示同样跟随语言', async () => {
    // 目录里给 acme 一个 model、探测拒绝 → `apiKeyPromptInvalid` 分支（不落库）。
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ models: [{ id: 'm1', provider: 'acme', api: 'openai-completions', baseUrl: 'https://example.test/v1' }] }) })),
    )
    typeKey('sk-bad')
    clickSave()

    await vi.waitFor(() => expect(hasText('✗ Invalid')).toBe(true))

    applyAppLanguageFromSnapshot('zh')
    expect(hasText('✗ 无效')).toBe(true)
    expect(hasText('✗ Invalid')).toBe(false)
  })
})
