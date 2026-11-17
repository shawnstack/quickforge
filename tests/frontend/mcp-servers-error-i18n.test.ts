import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { harness, nodes, text } from './settings-react-harness'

vi.mock('react', async (original) => ({ ...(await original<typeof import('react')>()), ...(await import('./settings-react-harness')).hooks }))
vi.mock('@/components/ui/info-tip', () => ({ InfoTip: () => null }))
vi.mock('@/components/ui/confirm-dialog', () => ({ showConfirm: vi.fn() }))

import { McpServersPanel } from '../../src/components/mcp-servers-dialog'
import { applyAppLanguageFromSnapshot } from '../../src/lib/i18n'

// 用户从 README / 别处整段粘贴的典型形状：两台服务器。
const multiServerText = JSON.stringify(
  {
    mcpServers: {
      a: { command: 'npx', args: ['a'] },
      b: { command: 'npx', args: ['b'] },
    },
  },
  null,
  2,
)

beforeEach(() => {
  harness.reset()
  applyAppLanguageFromSnapshot('en')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ servers: [] }), { status: 200 })))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function render() {
  harness.begin()
  return nodes(McpServersPanel({ active: true }))
}

const hasText = (value: string) => render().some((node) => text(node).includes(value))

function clickButton(label: string) {
  render().find((node) => node.type === 'button' && text(node) === label)!.props.onClick()
}

// 错误态只存键、渲染侧现取译文（与 e71b6c38 的 ShareConversationDialog 同判据）：
// 错误显示后用户切语言，错误句必须跟着换，而不是冻在构造错误那一刻的语言上。
describe('McpServersPanel 错误文案跟随语言切换', () => {
  it('多服务器保存被拦下后切语言，提示跟着换成新语言', async () => {
    clickButton('Add server')
    clickButton('JSON')

    render().find((node) => node.type === 'textarea')!.props.onChange({ target: { value: multiServerText } })

    clickButton('Save')
    await Promise.resolve()

    await vi.waitFor(() => expect(hasText('This config contains 2 servers')).toBe(true))
    expect(hasText('这份配置里有 2 台服务器')).toBe(false)

    applyAppLanguageFromSnapshot('zh')
    expect(hasText('这份配置里有 2 台服务器')).toBe(true)
    expect(hasText('This config contains 2 servers')).toBe(false)
  })
})
