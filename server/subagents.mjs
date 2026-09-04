import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { builtinAgentsDir, ensureStorage } from './storage.mjs'

const commonSubagentRules = `
You are a focused QuickForge subagent invoked by a parent coding assistant.

Rules:
- Work only on the delegated task. Do not broaden scope.
- Do not ask the user questions directly. If required information is missing, report it under "Needs clarification".
- Prefer evidence from read_file and grep_files before making claims.
- Treat your findings as advisory; the parent assistant makes final decisions.
- Do not attempt to call or simulate other subagents.
- Keep the response concise and structured.

Return this structure when practical:
1. Summary
2. Work performed or findings with evidence, including file paths when relevant
3. Risks or unknowns
4. Suggested next steps
`.trim()

export const subagentDefinitions = [
  {
    name: 'general',
    label: 'General',
    mode: 'subagent',
    description: 'A general-purpose agent for bounded complex multi-step implementation or broader independent work. It has full built-in workspace tool access; MCP tools and Agent Skills depend on the profile settings and parent session. Prefer Explore for focused read-only repository discovery, source search, tests/docs discovery, and impact analysis.',
    allowedTools: ['read_file', 'grep_files', 'write_file', 'edit_file', 'run_command'],
    capabilityPolicy: 'code-edit',
    model: { mode: 'inherit' },
    lifecycle: 'builtin',
    allowFileMutations: true,
    allowMcpTools: false,
    allowAgentSkills: false,
    maxRuntimeMs: 2 * 60 * 60 * 1000,
    maxToolCalls: 300,
    systemPrompt: `You are General, a general-purpose subagent for bounded complex multi-step implementation tasks and broader independent work. You may inspect, edit, write files, and run commands using the built-in workspace tools when needed. MCP tools and Agent Skills are available only when enabled by this profile and present in the parent session. Prefer Explore for focused read-only repository discovery, source search, call-chain lookup, tests/docs discovery, and impact analysis. Make focused, minimal changes that satisfy the delegated task, and verify your changes when appropriate.`,
  },
  {
    name: 'explore',
    label: 'Explore',
    mode: 'subagent',
    description: 'The preferred subagent for focused read-only repository exploration, file discovery, source search, call-chain lookup, related tests/docs/wiki discovery, safe inspection commands, pattern lookup, and impact analysis before non-trivial implementation. It cannot modify files.',
    allowedTools: ['read_file', 'grep_files', 'run_command'],
    capabilityPolicy: 'readonly-research',
    model: { mode: 'inherit' },
    lifecycle: 'builtin',
    allowFileMutations: false,
    allowMcpTools: false,
    allowAgentSkills: false,
    maxRuntimeMs: 2 * 60 * 60 * 1000,
    maxToolCalls: 300,
    systemPrompt: `You are Explore, the preferred read-only repository research subagent. Investigate the delegated question using read_file, grep_files, and safe read-only run_command calls, and report only findings grounded in repository evidence. Do not design solutions or propose implementation, architecture, refactoring, or code changes. Cite relevant file paths, symbols, and line ranges when practical. Clearly separate verified facts, reasonable inferences, and unknowns, and never present an inference as a verified fact. Unless the parent Agent explicitly requests them, do not provide an implementation plan, recommendations, or suggested next steps. You cannot modify files.`,
  },
]

const subagentByName = new Map(subagentDefinitions.map((definition) => [definition.name, definition]))

function markdownValue(value) {
  return String(value ?? '').replace(/\r?\n/g, ' ').replace(/"/g, '\\"')
}

function builtinSubagentMarkdown(definition) {
  const body = definition.systemPrompt || ''
  const hash = createHash('sha256').update(JSON.stringify({
    name: definition.name,
    label: definition.label,
    description: definition.description,
    allowedTools: definition.allowedTools,
    capabilityPolicy: definition.capabilityPolicy,
    body,
  })).digest('hex')
  return `---
name: ${definition.name}
label: "${markdownValue(definition.label || definition.name)}"
description: "${markdownValue(definition.description || '')}"
source: builtin
lifecycle: builtin
managed: true
managedBy: quickforge
managedHash: ${hash}
enabled-as-subagent: true
capabilityPolicy: ${definition.capabilityPolicy || 'review-only'}
tools: ${definition.allowedTools.join(', ')}
model:
  mode: inherit
max-runtime-ms: ${definition.maxRuntimeMs || 2 * 60 * 60 * 1000}
max-tool-calls: ${definition.maxToolCalls || 300}
allow-mcp-tools: ${definition.allowMcpTools === true ? 'true' : 'false'}
allow-agent-skills: ${definition.allowAgentSkills === true ? 'true' : 'false'}
---
${body}
`
}

export async function ensureBuiltinSubagentMarkdownFiles() {
  await ensureStorage()
  await fs.mkdir(builtinAgentsDir, { recursive: true })
  await Promise.all(subagentDefinitions.map(async (definition) => {
    const file = path.join(builtinAgentsDir, `${definition.name}.md`)
    const content = builtinSubagentMarkdown(definition)
    if (existsSync(file)) {
      const current = await fs.readFile(file, 'utf8').catch(() => '')
      if (current === content) return
    }
    await fs.writeFile(file, content, 'utf8')
  }))
}

export function builtinSubagentProfilePath(name) {
  return path.join(builtinAgentsDir, `${String(name || '').trim().toLowerCase()}.md`)
}

export function getSubagentDefinition(name) {
  return subagentByName.get(String(name || '').trim().toLowerCase()) || null
}

function withoutAvailableSkillsPrompt(prompt) {
  return String(prompt || '').replace(/\n?<available_skills>[\s\S]*?<\/available_skills>\n?/g, '\n')
}

export function composeSubagentSystemPrompt({
  definition,
  parentSystemPrompt,
  projectContext,
  effectiveAllowedTools = definition.allowedTools,
}) {
  const workspaceLines = []
  if (projectContext?.project?.name) workspaceLines.push(`- Project name: ${projectContext.project.name}`)
  if (projectContext?.workspaceRoot) workspaceLines.push(`- Workspace root: ${projectContext.workspaceRoot}`)
  if (projectContext?.project?.id) workspaceLines.push(`- Project ID: ${projectContext.project.id}`)
  const allowedTools = Array.isArray(effectiveAllowedTools) ? effectiveAllowedTools : definition.allowedTools
  const hasMcpTools = allowedTools.some((toolName) => toolName.startsWith('mcp__'))
  const hasAgentSkills = allowedTools.includes('activate_skill') || allowedTools.includes('read_skill_resource')
  const parentPrompt = hasAgentSkills ? parentSystemPrompt : withoutAvailableSkillsPrompt(parentSystemPrompt)

  return [
    parentPrompt || '',
    '<subagent_instructions>',
    `Subagent: ${definition.label || definition.name}`,
    `Mode: ${definition.mode || 'subagent'}`,
    `Description: ${definition.description}`,
    '',
    definition.systemPrompt,
    '',
    commonSubagentRules,
    '',
    'Tool constraints:',
    `- Allowed tools: ${allowedTools.join(', ')}`,
    hasMcpTools ? '- MCP tools inherited from the parent session are available and remain subject to the parent session approval/YOLO policy.' : '- MCP tools are not available to this subagent.',
    hasAgentSkills ? '- Agent Skill tools inherited from the parent session are available.' : '- Agent Skill tools are not available to this subagent.',
    '- run_subagent is not available to subagents.',
    definition.allowFileMutations
      ? '- File modification tools are available when needed, subject to the parent session approval/YOLO policy.'
      : definition.allowedTools.includes('run_command')
        ? '- This subagent is read-only. Do not modify files. Use run_command only for safe inspection or diagnostic commands.'
        : '- This subagent is read-only. Do not modify files or run commands.',
    workspaceLines.length ? `\nWorkspace context:\n${workspaceLines.join('\n')}` : '',
    '</subagent_instructions>',
  ].filter(Boolean).join('\n')
}

export function formatSubagentTask(params) {
  const task = String(params?.task || '').trim()
  const context = String(params?.context || '').trim()
  const expectedOutput = String(params?.expectedOutput || '').trim()

  return [
    '<delegated_task>',
    task,
    '</delegated_task>',
    context ? `\n<context>\n${context}\n</context>` : '',
    expectedOutput ? `\n<expected_output>\n${expectedOutput}\n</expected_output>` : '',
  ].filter(Boolean).join('\n')
}
