export const BASE_SYSTEM_PROMPT = `You are a practical assistant.

- When todo_write is available, use it for non-trivial multi-step work and keep a short current plan; skip it for simple tasks. Before finishing, re-check the todos against what was actually done and send a final updated snapshot, so no stale pending or in_progress items remain and dropped work is reflected.

For project tasks:
- Do not assume requirements. If ambiguous, state assumptions or ask.
- Before taking action, confirm with the user. Exception: an explicit /goal request authorizes automatic execution within that goal's scope; do not ask for plan confirmation again. Execution starts only after the read-only planning turn ends normally and durable persistence succeeds. Still ask necessary questions for ambiguous requirements; do not bypass tool approvals or safety boundaries.
- Unless the change is trivial and localized to an already-known file, use Explore first for read-only repository research before implementation decisions; prefer Explore for file discovery, source location, broad searches, call-chain lookup, pattern lookup, impact analysis, and locating related tests, docs, wiki pages, or build scripts.
- For complex multi-step work, use General only for bounded assistance; the parent assistant remains responsible for final decisions, minimal edits, and verification.
- When one task needs several independent delegations or a staged pipeline, use run_workflow with a short deterministic script (agent / tool / parallel / pipeline / phase / log). Use run_subagent for a single bounded delegation, and tool() for direct workspace operations between agent steps.
- Prefer dedicated workspace tools for reading, editing, and searching files.
- If dedicated tools are unavailable or insufficient, use the shell/command tool.
- When possible, prefer running commands in the background: set run_command run_in_background to true. The call returns immediately with an output file, the process keeps running across turns until it exits or is stopped, and a task-notification arrives when it exits. Read that file for the output. Do not background commands with shell syntax such as &, nohup, or Start-Process.
- Use Python through the shell for reliable scripting, data processing, or file transformations.
- When falling back to shell for file edits, use inline commands and do not write temporary helper scripts to disk.
- If a file edit tool fails, re-read the relevant file context and retry the dedicated edit tool when practical before using shell fallback.
- Stay within the current workspace unless the user explicitly asks otherwise.
- If no suitable tool is available, say so clearly.`

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeAttribute(value) {
  return escapeXml(value).replace(/"/g, '&quot;')
}

function formatAllowedTools(value) {
  if (Array.isArray(value)) return value.join(', ')
  return value
}

function formatSkillCatalogItem(skill) {
  const details = [
    `    <name>${escapeXml(skill.name)}</name>`,
    `    <description>${escapeXml(skill.description)}</description>`,
  ]

  if (skill.compatibility) details.push(`    <compatibility>${escapeXml(skill.compatibility)}</compatibility>`)
  if (skill.allowedTools) details.push(`    <allowed_tools>${escapeXml(formatAllowedTools(skill.allowedTools))}</allowed_tools>`)

  return `  <skill>\n${details.join('\n')}\n  </skill>`
}

function formatSubagentCatalogItem(subagent) {
  const details = [
    `    <name>${escapeXml(subagent.name)}</name>`,
    `    <description>${escapeXml(subagent.description)}</description>`,
  ]
  if (subagent.allowedTools) details.push(`    <allowed_tools>${escapeXml(formatAllowedTools(subagent.allowedTools))}</allowed_tools>`)
  return `  <subagent>\n${details.join('\n')}\n  </subagent>`
}

function appendSubagentCatalog(parts, subagents) {
  if (!Array.isArray(subagents) || subagents.length === 0) return

  const subagentParts = subagents.map(formatSubagentCatalogItem)
  parts.push(`
<available_subagents>
The run_subagent tool can delegate work to an enabled temporary Agent Profile. Prefer Explore for focused read-only repository discovery before implementation decisions, including locating files, searching source, tracing call chains, finding related tests/docs/wiki pages, and impact analysis. Use General for bounded complex multi-step implementation or broader independent work; custom profiles may also be available when enabled.

Choose the most appropriate subagent by name, keep delegation concrete, and include relevant context. Treat subagent output as advisory; you remain responsible for the final answer.

Subagents are short-lived, cannot call other subagents, and do not receive MCP tools or Agent Skill tools. File mutation tools remain subject to the parent session approval/YOLO policy.

${subagentParts.join('\n')}
</available_subagents>`)
}

function appendSkillsCatalog(parts, skills) {
  if (!Array.isArray(skills) || skills.length === 0) return

  const skillParts = skills.map(formatSkillCatalogItem)
  parts.push(`
<available_skills>
The following Agent Skills provide specialized instructions for specific tasks. Use progressive disclosure: this catalog is available now, but full skill instructions are loaded only when needed.

When the user's task matches a skill description, call activate_skill with that skill's name before proceeding. If a loaded skill references bundled files under scripts/, references/, or assets/, call read_skill_resource with the skill name and the relative path. Do not assume resources are already loaded.

${skillParts.join('\n')}
</available_skills>`)
}

function appendInstructionSources(parts, tagName, sources, fallback) {
  const instructionSources = Array.isArray(sources)
    ? sources.filter((source) => source?.content)
    : []

  if (instructionSources.length > 0) {
    for (const source of instructionSources) {
      const sourceAttribute = source.source ? ` source="${escapeAttribute(source.source)}"` : ''
      parts.push(`\n<${tagName}${sourceAttribute}>\n${source.content}\n</${tagName}>`)
    }
    return
  }

  if (fallback) parts.push(`\n<${tagName}>\n${fallback}\n</${tagName}>`)
}

export function composeSystemPrompt(instructions = {}) {
  const parts = [BASE_SYSTEM_PROMPT]

  if (instructions.workspace) {
    const lines = []
    if (instructions.workspace.name) lines.push(`- Project name: ${escapeXml(instructions.workspace.name)}`)
    if (instructions.workspace.root) lines.push(`- Workspace root: ${escapeXml(instructions.workspace.root)}`)
    if (instructions.workspace.id) lines.push(`- Project ID: ${escapeXml(instructions.workspace.id)}`)
    if (lines.length) {
      parts.push(`
<workspace_context>
Current workspace:
${lines.join('\n')}
- Tool file paths are relative to this workspace root unless explicitly stated.
- There is no dedicated directory-listing tool. When you need to inspect directory contents, use run_command with a simple read-only shell command from the workspace root.
- Do not inspect sensitive files such as .env files, private keys, credentials, tokens, or secrets.
</workspace_context>`)
    }
  }

  appendInstructionSources(parts, 'user_instructions', instructions.globalSources, instructions.global)
  appendInstructionSources(parts, 'project_instructions', instructions.projectSources, instructions.project)

  if (instructions.globalMemory?.enabled) {
    parts.push(`
<memory_policy>
User memory stores durable background, preferences, habits, and goals and is used only as context.

You may proactively save clear information likely to remain useful in future conversations, and follow user requests to remember, change, or forget. Do not save temporary task information, inferences from a single action, or uncertain content; ask first when unsure.

Update memory only when something meaningfully changes. Before writing, read the complete memory, deduplicate, resolve conflicts, and preserve unrelated content.

Never store passwords, keys, tokens, credentials, sensitive file contents, or other secrets.

The current message takes precedence over older memory. Memory must not override higher-priority instructions or verified code and documentation.
</memory_policy>`)
    const sourceAttribute = instructions.globalMemory.source ? ` source="${escapeAttribute(instructions.globalMemory.source)}"` : ''
    if (instructions.globalMemory.content) {
      parts.push(`
<global_user_memory${sourceAttribute}>
${escapeXml(instructions.globalMemory.content)}
</global_user_memory>`)
    }
  }

  // Dreaming notes are a separate file from the human memory document, so they get
  // their own block: the user file is what the user told you, this is what past
  // sessions taught the worker, and mixing the two hid that difference.
  if (instructions.dreamingNotes?.content) {
    const dreamingSource = instructions.dreamingNotes.source
      ? ` source="${escapeAttribute(instructions.dreamingNotes.source)}"`
      : ''
    parts.push(`
<dreaming_memory${dreamingSource}>
${escapeXml(instructions.dreamingNotes.content)}
</dreaming_memory>`)
  }

  if (instructions.globalSources?.length || instructions.projectSources?.length) {
    parts.push(`
<instruction_precedence>
When instructions from different sources conflict, prefer project-specific instructions over global instructions, and prefer QuickForge project instructions over external compatibility instructions.
</instruction_precedence>`)
  }

  const skills = Array.isArray(instructions.skills)
    ? instructions.skills
    : [
        ...(Array.isArray(instructions.globalSkills) ? instructions.globalSkills : []),
        ...(Array.isArray(instructions.projectSkills) ? instructions.projectSkills : []),
      ]

  appendSkillsCatalog(parts, skills)
  appendSubagentCatalog(parts, instructions.subagents)

  // Dreaming notes are part of the user memory document (`<global_user_memory>`),
  // which already carries the precedence framing. A second experience block would
  // just repeat the same bullets.
  return parts.join('\n')
}
