import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}), { virtual: true })

import {
  buildApprovalCardDisplayModel,
  buildApprovalCardDisplaySignature,
  getToolApprovalDisplayName,
  parseMcpToolName,
  parsePluginToolName,
  summarizeToolArgs,
} from '../../src/components/chat/panel-decoration/approval-card'

const copy: Record<string, string> = {
  manageGlobalMemory: 'Manage Memory',
  readFile: 'Read File',
  searchFiles: 'Search Files',
  writeFile: 'Write File',
  editFile: 'Edit File',
  runCommand: 'Run Command',
  presentFiles: 'Present Files',
  activateSkill: 'Activate Skill',
  readSkillResource: 'Read Skill Resource',
  runSubagent: 'Run subagent',
  generateImage: 'Generate Image',
  toolApprovalNeedsConfirmation: 'Confirmation required',
  toolApprovalRiskCommand: 'command risk',
  toolApprovalRiskFileChange: 'file risk',
  toolApprovalRiskExternal: 'external risk',
  toolApprovalRiskGeneric: 'generic risk',
  toolApprovalAccept: 'Allow once',
  toolApprovalReject: 'Reject',
  toolApprovalSource: 'Source',
  toolApprovalServer: 'Server',
  toolApprovalPlugin: 'Plugin',
  toolApprovalTool: 'Tool',
  toolApprovalPath: 'Path',
  toolApprovalCommand: 'Command',
  toolApprovalDisabled: 'Disabled here',
  autoCompactApprovalStatus: 'Context near limit',
  autoCompactApprovalTitle: 'Compact older conversation content',
  autoCompactApprovalRisk: 'compact risk {keepRecentTurns}',
  autoCompactApprovalAccept: 'Compact now',
  autoCompactApprovalReject: 'Not now',
}

const translate = (key: keyof typeof copy, params?: Record<string, string | number>) => {
  let value = copy[key] ?? key
  for (const [name, replacement] of Object.entries(params ?? {})) value = value.replaceAll(`{${name}}`, String(replacement))
  return value
}

describe('approval card display model', () => {
  it('covers friendly names for all current built-in tool i18n keys', () => {
    expect(getToolApprovalDisplayName('manage_global_memory', translate)).toBe('Manage Memory')
    expect(getToolApprovalDisplayName('read_file', translate)).toBe('Read File')
    expect(getToolApprovalDisplayName('grep_files', translate)).toBe('Search Files')
    expect(getToolApprovalDisplayName('write_file', translate)).toBe('Write File')
    expect(getToolApprovalDisplayName('edit_file', translate)).toBe('Edit File')
    expect(getToolApprovalDisplayName('run_command', translate)).toBe('Run Command')
    expect(getToolApprovalDisplayName('present_files', translate)).toBe('Present Files')
    expect(getToolApprovalDisplayName('activate_skill', translate)).toBe('Activate Skill')
    expect(getToolApprovalDisplayName('read_skill_resource', translate)).toBe('Read Skill Resource')
    expect(getToolApprovalDisplayName('run_subagent', translate)).toBe('Run subagent')
    expect(getToolApprovalDisplayName('generate_image', translate)).toBe('Generate Image')
  })

  it('parses MCP and Plugin names into friendly labels', () => {
    expect(parseMcpToolName('mcp__github__create_issue')).toEqual({ serverName: 'github', toolName: 'create_issue' })
    expect(getToolApprovalDisplayName('mcp__github__create_issue', translate)).toBe('MCP · github · create_issue')
    expect(parsePluginToolName('plugin__release__publish_package')).toEqual({ pluginName: 'release', toolName: 'publish_package' })
    expect(getToolApprovalDisplayName('plugin__release__publish_package', translate)).toBe('Plugin · release · publish_package')
  })

  it('builds warning and info copy separately', () => {
    const warning = buildApprovalCardDisplayModel({ toolName: 'run_command', args: {}, translate })
    const info = buildApprovalCardDisplayModel({ toolName: 'contextManagement', args: { keepRecentTurns: 6 }, tone: 'info', translate })

    expect(warning).toMatchObject({ tone: 'warning', status: 'Confirmation required', approveLabel: 'Allow once', rejectLabel: 'Reject', risk: 'command risk' })
    expect(info).toMatchObject({ tone: 'info', status: 'Context near limit', title: 'Compact older conversation content', approveLabel: 'Compact now', rejectLabel: 'Not now', risk: 'compact risk 6' })
  })

  it('keeps command summary visible in the display model', () => {
    expect(summarizeToolArgs('run_command', { command: 'npm run test' })).toBe('npm run test')
    const model = buildApprovalCardDisplayModel({ toolName: 'run_command', args: { command: 'npm run test' }, translate })
    expect(model.keySummary).toBe('npm run test')
    expect(model.criticalParameters).toContainEqual({ label: 'Command', value: 'npm run test' })
  })

  it('keeps disabled state and reason explicit', () => {
    const model = buildApprovalCardDisplayModel({
      toolName: 'edit_file',
      args: { path: 'src/index.css' },
      disabled: true,
      disabledReason: 'Handle in original conversation',
      translate,
    })
    expect(model.disabled).toBe(true)
    expect(model.disabledReason).toBe('Handle in original conversation')
    expect(model.criticalParameters).toContainEqual({ label: 'Path', value: 'src/index.css' })
  })

  it('builds a stable signature that changes with dynamic presentation', () => {
    const input = { toolName: 'run_command', args: { command: 'npm test' }, translate } as const
    const enabled = buildApprovalCardDisplayModel(input)
    const enabledAgain = buildApprovalCardDisplayModel(input)
    const disabled = buildApprovalCardDisplayModel({ ...input, disabled: true, disabledReason: 'Read only' })
    const customCopy = buildApprovalCardDisplayModel({ ...input, copy: { title: 'Custom title' } })

    expect(buildApprovalCardDisplaySignature(enabledAgain)).toBe(buildApprovalCardDisplaySignature(enabled))
    expect(buildApprovalCardDisplaySignature(disabled)).not.toBe(buildApprovalCardDisplaySignature(enabled))
    expect(buildApprovalCardDisplaySignature(customCopy)).not.toBe(buildApprovalCardDisplaySignature(enabled))
  })
})
