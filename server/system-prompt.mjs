export const BASE_SYSTEM_PROMPT = `You are a pragmatic coding assistant.

For project tasks:
- Inspect the workspace before changing files.
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

function formatSkillCatalogItem(skill) {
  const details = [
    `    <name>${escapeXml(skill.name)}</name>`,
    `    <description>${escapeXml(skill.description)}</description>`,
  ]

  if (skill.compatibility) details.push(`    <compatibility>${escapeXml(skill.compatibility)}</compatibility>`)
  if (skill.allowedTools) details.push(`    <allowed_tools>${escapeXml(skill.allowedTools)}</allowed_tools>`)

  return `  <skill>\n${details.join('\n')}\n  </skill>`
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

export function composeSystemPrompt(instructions = {}) {
  const parts = [BASE_SYSTEM_PROMPT]

  if (instructions.global) {
    parts.push(`\n<user_instructions>\n${instructions.global}\n</user_instructions>`)
  }

  if (instructions.project) {
    parts.push(`\n<project_instructions>\n${instructions.project}\n</project_instructions>`)
  }

  const skills = Array.isArray(instructions.skills)
    ? instructions.skills
    : [
        ...(Array.isArray(instructions.globalSkills) ? instructions.globalSkills : []),
        ...(Array.isArray(instructions.projectSkills) ? instructions.projectSkills : []),
      ]

  appendSkillsCatalog(parts, skills)

  return parts.join('\n')
}
