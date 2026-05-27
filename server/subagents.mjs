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
    description: 'A general-purpose agent for researching complex problems and executing multi-step tasks. It has full built-in workspace tool access, excluding MCP tools and Agent Skills, so it can modify files when needed. Use it for substantial independent work units, including parallelizable work.',
    allowedTools: ['read_file', 'grep_files', 'write_file', 'edit_file', 'run_command'],
    allowFileMutations: true,
    maxRuntimeMs: 30 * 60 * 1000,
    maxToolCalls: 300,
    systemPrompt: `You are General, a general-purpose subagent for complex research and multi-step implementation tasks. You may inspect, edit, write files, and run commands using the built-in workspace tools when needed. You do not have MCP tools or Agent Skills. Make focused, minimal changes that satisfy the delegated task, and verify your changes when appropriate.`,
  },
  {
    name: 'explore',
    label: 'Explore',
    mode: 'subagent',
    description: 'A fast read-only agent for targeted exploration and focused questions. It cannot modify files. Use it to quickly find relevant files, search keywords, identify patterns, or summarize findings.',
    allowedTools: ['read_file', 'grep_files'],
    allowFileMutations: false,
    maxRuntimeMs: 30 * 60 * 1000,
    maxToolCalls: 300,
    systemPrompt: `You are Explore, a fast read-only exploration subagent. Use read_file and grep_files to locate relevant files, search keywords, identify patterns, and answer focused questions. You cannot modify files or run commands.`,
  },
]

const subagentByName = new Map(subagentDefinitions.map((definition) => [definition.name, definition]))

export function listSubagentSummaries() {
  return subagentDefinitions.map(({ name, label, mode, description, allowedTools }) => ({
    name,
    label,
    mode,
    description,
    allowedTools: [...allowedTools],
  }))
}

export function getSubagentDefinition(name) {
  return subagentByName.get(String(name || '').trim().toLowerCase()) || null
}

export function composeSubagentSystemPrompt({ definition, parentSystemPrompt, projectContext }) {
  const workspaceLines = []
  if (projectContext?.project?.name) workspaceLines.push(`- Project name: ${projectContext.project.name}`)
  if (projectContext?.workspaceRoot) workspaceLines.push(`- Workspace root: ${projectContext.workspaceRoot}`)
  if (projectContext?.project?.id) workspaceLines.push(`- Project ID: ${projectContext.project.id}`)

  return [
    parentSystemPrompt || '',
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
    `- Allowed tools: ${definition.allowedTools.join(', ')}`,
    '- MCP tools and Agent Skill tools are not available to subagents.',
    '- run_subagent is not available to subagents.',
    definition.allowFileMutations
      ? '- File modification tools are available when needed, subject to the parent session approval/YOLO policy.'
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
