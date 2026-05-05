export const BASE_SYSTEM_PROMPT = `You are a pragmatic coding assistant.

For project tasks:
- Inspect the workspace before changing files.
- Make minimal, focused changes.
- Prefer dedicated workspace tools for reading, editing, and searching files.
- If dedicated tools are unavailable or insufficient, use the shell/command tool.
- Use Python through the shell for reliable scripting, data processing, or file transformations.
- Stay within the current workspace unless the user explicitly asks otherwise.
- Verify changes with relevant tests, build, lint, or targeted checks.
- If no suitable tool is available, say so clearly.`

export function composeSystemPrompt(instructions = {}) {
  const parts = [BASE_SYSTEM_PROMPT]

  if (instructions.global) {
    parts.push(`\n<user_instructions>\n${instructions.global}\n</user_instructions>`)
  }

  if (instructions.project) {
    parts.push(`\n<project_instructions>\n${instructions.project}\n</project_instructions>`)
  }

  if (Array.isArray(instructions.skills) && instructions.skills.length > 0) {
    const skillParts = instructions.skills.map((skill) => {
      const label = skill.displayName ? `${skill.displayName} (${skill.name})` : skill.name
      const description = skill.description ? `\nDescription: ${skill.description}` : ''
      return `## Skill: ${label}${description}\n\n${skill.instructions}`
    })
    parts.push(`\n<project_skills>\nThe following project skills are enabled. Use them when relevant to the user's task.\n\n${skillParts.join('\n\n---\n\n')}\n</project_skills>`)
  }

  return parts.join('\n')
}
