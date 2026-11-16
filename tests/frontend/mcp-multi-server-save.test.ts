import { beforeEach, describe, expect, it, vi } from 'vitest'
import { harness, nodes, text } from './settings-react-harness'

vi.mock('react', async (original) => ({ ...(await original<typeof import('react')>()), ...(await import('./settings-react-harness')).hooks }))
vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }))
vi.mock('@/components/ui/info-tip', () => ({ InfoTip: () => null }))
vi.mock('@/components/ui/confirm-dialog', () => ({ showConfirm: vi.fn() }))

import { McpServersPanel } from '../../src/components/mcp-servers-dialog'

const fetchMock = vi.fn(async () => new Response(JSON.stringify({ servers: [] }), { status: 200 }))

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

function render() {
  harness.begin()
  return nodes(McpServersPanel({ active: true }))
}

function button(label: string) {
  return render().find((node) => node.type === 'button' && text(node) === label)
}

describe('McpServersPanel 在 JSON 视图保存多服务器配置', () => {
  beforeEach(() => {
    harness.reset()
    fetchMock.mockClear()
    vi.stubGlobal('fetch', fetchMock)
  })

  // 草稿只装得下一台服务器（jsonToDraft 取 mcpServers 第一条），所以「照常保存」＝
  // 其余服务器静默消失。这条用例要的是「不发请求 + 明确告诉用户一次只能存一台」。
  it('多服务器配置点保存时不发 PUT，而是给出明确提示', async () => {
    button('mcpAddServer')!.props.onClick()
    render()
      .find((node) => node.type === 'button' && text(node) === 'mcpTabJson')!
      .props.onClick()

    const area = render().find((node) => node.type === 'textarea')!
    ;(area.props.onChange as (event: unknown) => void)({ target: { value: multiServerText } })

    const save = button('save')!
    expect(save.props.disabled).toBe(false)
    save.props.onClick()
    await Promise.resolve()

    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')).toBe(false)
    expect(render().some((node) => text(node).includes('mcpMultipleServersSave'))).toBe(true)
  })

  it('单服务器配置照旧保存（提示不该拦正常路径）', async () => {
    button('mcpAddServer')!.props.onClick()
    render()
      .find((node) => node.type === 'button' && text(node) === 'mcpTabJson')!
      .props.onClick()

    const singleText = JSON.stringify({ mcpServers: { a: { command: 'npx', args: ['a'] } } }, null, 2)
    const area = render().find((node) => node.type === 'textarea')!
    ;(area.props.onChange as (event: unknown) => void)({ target: { value: singleText } })

    button('save')!.props.onClick()
    await Promise.resolve()

    const puts = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'PUT')
    expect(puts).toHaveLength(1)
  })
})
