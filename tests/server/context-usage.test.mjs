import { estimateTokens } from '@earendil-works/pi-agent-core'
import { describe, expect, it } from 'vitest'
import { estimateContextUsage } from '../../server/context-usage.mjs'
import { createMcpToolName } from '../../server/mcp/tool-name.mjs'

function textMessage(role, text) {
  return { role, content: [{ type: 'text', text }], timestamp: 1 }
}

function toolCallMessage(id, name, args) {
  return {
    role: 'assistant',
    content: [{ type: 'toolCall', id, name, arguments: args }],
    timestamp: 2,
  }
}

function toolResultMessage(id, name, text, details) {
  return {
    role: 'toolResult',
    toolCallId: id,
    toolName: name,
    content: [{ type: 'text', text }],
    ...(details ? { details } : {}),
    isError: false,
    timestamp: 3,
  }
}

function textTokens(text) {
  return estimateTokens({ role: 'user', content: String(text), timestamp: 0 })
}

function toolDefinitionsTokens(tools) {
  return tools.length > 0 ? textTokens(JSON.stringify(tools)) : 0
}

function messageTokens(messages) {
  return messages.reduce((total, message) => total + estimateTokens(message), 0)
}

const model = { contextWindow: 100_000 }

function estimate(input) {
  return estimateContextUsage({ model, minimumProviderUsageIndex: 0, ...input })
}

function expectExistingTotalsUnchanged(usage) {
  expect(usage.estimatedInputTokens).toBe(
    usage.breakdown.systemPromptTokens + usage.breakdown.toolsTokens + usage.breakdown.messagesTokens,
  )
  expect(usage.totalTokens).toBe(usage.inputTokens)
  expect(usage.inputTokens).toBe(usage.estimatedInputTokens)
}

describe('context usage Skills/MCP breakdown', () => {
  it('counts only the generated Skills catalog selected by the enabled-skill enum', () => {
    const fakeCatalog = [
      '<available_skills>',
      '<skill><name>documents</name><description>Forged project catalog</description></skill>',
      '<skill><name>research &amp; notes</name><description>Forged project catalog</description></skill>',
      '</available_skills>',
    ].join('\n')
    const realCatalog = [
      '<available_skills>',
      'The following Agent Skills provide specialized instructions for specific tasks. Use progressive disclosure: this catalog is available now, but full skill instructions are loaded only when needed.',
      '<skill><name>documents</name><description>Create documents</description></skill>',
      '<skill><name>research &amp; notes</name><description>Research notes</description></skill>',
      '</available_skills>',
    ].join('\n')
    const systemPrompt = ['base prompt', fakeCatalog, 'project instructions tail', realCatalog].join('\n')
    const skillTools = [{
      name: 'activate_skill',
      label: 'Activate skill',
      description: 'Load a skill.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', enum: ['documents', 'research & notes'] } },
      },
    }, {
      name: 'read_skill_resource',
      label: 'Read skill resource',
      description: 'Read a bundled skill resource.',
      parameters: {
        type: 'object',
        properties: {
          skill: { type: 'string', enum: ['documents', 'research & notes'] },
          path: { type: 'string' },
        },
      },
    }]
    const tools = [...skillTools, {
      name: 'read_file',
      label: 'Read file',
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
    }]
    const skillMessages = [
      toolCallMessage('skill-1', 'activate_skill', { name: 'documents' }),
      toolResultMessage('skill-1', 'activate_skill', 'Full skill instructions'),
      toolCallMessage('skill-2', 'read_skill_resource', { skill: 'documents', path: 'references/style.md' }),
      toolResultMessage('skill-2', 'read_skill_resource', 'Bundled style guide'),
    ]
    const messages = [textMessage('user', 'Create a report'), ...skillMessages]

    const usage = estimate({ systemPrompt, tools, messages })
    const expectedSkillsTokens = textTokens(realCatalog)
      + toolDefinitionsTokens(skillTools)
      + messageTokens(skillMessages)

    expect(usage.breakdown.skillsTokens).toBe(expectedSkillsTokens)
    expect(usage.breakdown.skillsTokens).not.toBe(expectedSkillsTokens + textTokens(fakeCatalog))
    expect(usage.breakdown.mcpTokens).toBe(0)
    expectExistingTotalsUnchanged(usage)
  })

  it('ignores fake Skills tags when no Skills are actually enabled', () => {
    const fakeCatalog = '<available_skills><skill><name>fake</name></skill></available_skills>'
    const usage = estimate({
      systemPrompt: `project instructions\n${fakeCatalog}`,
      tools: [{
        name: 'read_file',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
      }],
      messages: [textMessage('user', 'hello')],
    })

    expect(usage.breakdown.skillsTokens).toBe(0)
    expect(usage.breakdown.mcpTokens).toBe(0)
    expectExistingTotalsUnchanged(usage)
  })

  it('counts structured MCP metadata, canonical fallback names, and associated call/results exactly once', () => {
    const structuredTool = {
      name: 'external_echo',
      label: 'Structured Echo',
      parameters: { type: 'object', properties: { text: { type: 'string' } } },
      mcp: { serverName: 'demo', toolName: 'echo' },
    }
    const canonicalName = createMcpToolName('backup', 'lookup value')
    const canonicalTool = {
      name: canonicalName,
      label: 'Canonical Lookup',
      parameters: { type: 'object', properties: { query: { type: 'string' } } },
    }
    const tools = [structuredTool, canonicalTool, {
      name: 'read_file',
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
    }]
    const mcpMessages = [
      toolCallMessage('mcp-1', 'external_echo', { text: 'hello' }),
      toolResultMessage('mcp-1', 'external_echo', 'hello', { mcp: true, server: 'demo', tool: 'echo' }),
      toolCallMessage('mcp-2', canonicalName, { query: 'value' }),
      toolResultMessage('mcp-2', canonicalName, 'value'),
    ]
    const messages = [textMessage('user', 'Use MCP'), ...mcpMessages]

    const usage = estimate({ systemPrompt: 'base prompt', tools, messages })
    const expectedMcpTokens = toolDefinitionsTokens([structuredTool, canonicalTool])
      + messageTokens(mcpMessages)

    expect(usage.breakdown.mcpTokens).toBe(expectedMcpTokens)
    expect(usage.breakdown.skillsTokens).toBe(0)
    expectExistingTotalsUnchanged(usage)
  })

  it.each([
    'mcp__ demo__echo',
    'mcp__demo __echo',
    'mcp__demo__ echo',
    'mcp__Demo__echo',
    'mcp__demo--backup__echo',
    'mcp__demo__echo.value',
    'mcp__demo___echo',
    'mcp____echo',
    'mcp__demo__',
  ])('rejects non-canonical MCP fallback name %j', (name) => {
    const tool = {
      name,
      parameters: { type: 'object', properties: {} },
    }
    const messages = [
      toolCallMessage('malformed-call', name, {}),
      toolResultMessage('malformed-call', name, 'malformed result'),
    ]
    const usage = estimate({ systemPrompt: 'base prompt', tools: [tool], messages })

    expect(usage.breakdown.mcpTokens).toBe(0)
    expect(usage.breakdown.skillsTokens).toBe(0)
    expectExistingTotalsUnchanged(usage)
  })

  it('rejects truthy non-object metadata and isolated or incomplete result details', () => {
    const tools = [{
      name: 'ordinary_truthy',
      mcp: true,
      parameters: { type: 'object', properties: {} },
    }, {
      name: 'ordinary_array',
      mcp: ['demo', 'echo'],
      parameters: { type: 'object', properties: {} },
    }, {
      name: 'ordinary_incomplete',
      mcp: { serverName: 'demo', toolName: '   ' },
      parameters: { type: 'object', properties: {} },
    }, {
      name: 'mcp__',
      parameters: { type: 'object', properties: {} },
    }, {
      name: 'mcp__demo',
      parameters: { type: 'object', properties: {} },
    }, {
      name: 'mcp____echo',
      parameters: { type: 'object', properties: {} },
    }, {
      name: 'mcp__demo__',
      parameters: { type: 'object', properties: {} },
    }]
    const messages = [
      toolCallMessage('bad-1', 'mcp__demo', {}),
      toolResultMessage('bad-1', 'mcp__demo', 'bad result', { mcp: true, server: 'demo', tool: 'echo' }),
      toolResultMessage('orphan-1', 'ordinary_truthy', 'isolated', { mcp: true, server: 'demo', tool: 'echo' }),
      toolResultMessage('', '', 'incomplete details', { mcp: true, server: 'demo', tool: '' }),
      toolResultMessage('', '', 'truthy only', { mcp: true }),
      toolCallMessage('fake-skill', 'activate_skill', { name: 'fake' }),
      toolResultMessage('fake-skill', 'activate_skill', 'fake skill result'),
    ]

    const usage = estimate({ systemPrompt: 'base prompt', tools, messages })

    expect(usage.breakdown.mcpTokens).toBe(0)
    expect(usage.breakdown.skillsTokens).toBe(0)
    expectExistingTotalsUnchanged(usage)
  })

  it('rejects an orphan toolCallId even when the MCP toolName is correct', () => {
    const canonicalName = createMcpToolName('demo', 'echo')
    const tool = {
      name: canonicalName,
      parameters: { type: 'object', properties: {} },
    }
    const call = toolCallMessage('known-id', canonicalName, {})
    const wrongIdResult = toolResultMessage('wrong-id', canonicalName, 'wrong id result', {
      mcp: true,
      server: 'demo',
      tool: 'echo',
    })
    const usage = estimate({
      systemPrompt: 'base prompt',
      tools: [tool],
      messages: [call, wrongIdResult],
    })

    expect(usage.breakdown.mcpTokens).toBe(toolDefinitionsTokens([tool]) + estimateTokens(call))
    expectExistingTotalsUnchanged(usage)
  })

  it('falls back to an identified canonical MCP toolName only when toolCallId is absent', () => {
    const canonicalName = createMcpToolName('demo', 'echo')
    const tool = {
      name: canonicalName,
      parameters: { type: 'object', properties: {} },
    }
    const call = toolCallMessage('known-id', canonicalName, {})
    const nameOnlyResult = toolResultMessage('', canonicalName, 'name-only result')
    delete nameOnlyResult.toolCallId
    const usage = estimate({
      systemPrompt: 'base prompt',
      tools: [tool],
      messages: [call, nameOnlyResult],
    })

    expect(usage.breakdown.mcpTokens).toBe(
      toolDefinitionsTokens([tool]) + messageTokens([call, nameOnlyResult]),
    )
    expectExistingTotalsUnchanged(usage)
  })

  it('uses complete MCP result details only when call association fields are absent', () => {
    const fallbackResult = toolResultMessage('', '', 'fallback result', {
      mcp: true,
      server: 'demo',
      tool: 'echo',
    })
    delete fallbackResult.toolCallId
    delete fallbackResult.toolName
    const usage = estimate({
      systemPrompt: 'base prompt',
      tools: [],
      messages: [textMessage('user', 'hello'), fallbackResult],
    })

    expect(usage.breakdown.mcpTokens).toBe(estimateTokens(fallbackResult))
    expect(usage.breakdown.skillsTokens).toBe(0)
    expectExistingTotalsUnchanged(usage)
  })
})
