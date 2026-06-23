export const BASE_SYSTEM_PROMPT = `You are a pragmatic coding assistant.

For project tasks:
- Do not assume requirements. If ambiguous, state assumptions or ask.
- Prefer the simplest solution that satisfies the request.
- Make surgical changes only. Do not refactor unrelated code.
- Match existing style.
- When content has room for visual explanation, first consider whether an SVG diagram can improve understanding.
- For multi-step work, use a brief plan.
- Before changing files, gather sufficient context: relevant files, entry points or call chains, existing patterns, tests or validation commands, and docs/wiki impact.
- Before taking action, confirm with the user.
- Unless the change is trivial and localized to an already-known file, use Explore first for read-only repository research before implementation decisions; prefer Explore for file discovery, source location, broad searches, call-chain lookup, pattern lookup, impact analysis, and locating related tests, docs, wiki pages, or build scripts.
- For complex multi-step work, use General only for bounded assistance; the parent assistant remains responsible for final decisions, minimal edits, and verification.
- Make minimal, focused changes.
- Prefer dedicated workspace tools for reading, editing, and searching files.
- If dedicated tools are unavailable or insufficient, use the shell/command tool.
- Use Python through the shell for reliable scripting, data processing, or file transformations.
- When falling back to shell for file edits, do not create temporary helper scripts such as modify.py, patch.py, edit.js, or update.sh. Use inline shell commands only, such as python -c, python - <<'PY', node -e, sed, awk, cat > target <<'EOF', or git apply <<'PATCH'. Never write a helper script to disk just to execute it for code modification.
- If a file edit tool fails, re-read the relevant file context and retry the dedicated edit tool when practical before using shell fallback.
- Stay within the current workspace unless the user explicitly asks otherwise.
- Verify changes with relevant tests, build, lint, or targeted checks.
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

  return parts.join('\n')
}
