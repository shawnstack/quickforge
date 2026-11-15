import { describe, expect, it } from 'vitest'
import {
  draftToJson,
  emptyMcpDraft,
  jsonTextForTab,
  jsonToDraft,
  type McpServerFormData,
} from '../../src/lib/mcp-helpers'

const draftA: McpServerFormData = {
  name: 'a',
  transport: 'stdio',
  command: 'npx',
  args: ['a'],
  url: '',
  cwd: '',
  env: {},
}

describe('jsonTextForTab', () => {
  it('keeps multi-server text the user wrote instead of collapsing it to the first server', () => {
    const userText = JSON.stringify(
      {
        mcpServers: {
          a: { command: 'npx', args: ['a'] },
          b: { command: 'npx', args: ['b'] },
        },
      },
      null,
      2,
    )
    const draft = jsonToDraft(userText)
    expect(draft.name).toBe('a')
    // 单服务器的 draft 装不下第二台；旧行为（无条件 draftToJson）会把 b 整段吃掉。
    expect(draftToJson(draft)).not.toBe(userText)
    expect(jsonTextForTab(userText, '', draft)).toBe(userText)
  })

  it('keeps unknown keys the draft cannot represent', () => {
    const userText = JSON.stringify(
      { mcpServers: { a: { command: 'npx', timeout: 30, disabled: true } } },
      null,
      2,
    )
    const draft = jsonToDraft(userText)
    expect(draftToJson(draft)).not.toContain('timeout')
    expect(jsonTextForTab(userText, '', draft)).toBe(userText)
  })

  it('regenerates from the draft while the text is still the copy it produced', () => {
    const baseline = draftToJson(emptyMcpDraft())
    expect(jsonTextForTab(baseline, baseline, draftA)).toBe(draftToJson(draftA))
  })

  it('returns the same text when the draft has not changed', () => {
    const baseline = draftToJson(draftA)
    expect(jsonTextForTab(baseline, baseline, draftA)).toBe(baseline)
  })
})
