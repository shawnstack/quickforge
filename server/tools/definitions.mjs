import { Type } from 'typebox'
import { loadSelectedGlobalSkills, loadSelectedProjectSkills, mergeSkills } from '../skills.mjs'

// ---------------------------------------------------------------------------
// Canonical workspace tool definitions.
// These are the single source of truth for tool metadata (name, label,
// description, parameters). Both the server agent-manager (which wraps them
// with execute handlers) and the GET /api/tools endpoint (which returns them
// as JSON) import from here.
//
// When adding a new tool, add its definition here. The agent-manager connects
// it to a handler, and the frontend can fetch definitions from /api/tools.
// ---------------------------------------------------------------------------

export const subagentTool = {
  name: 'run_subagent',
  label: 'Run subagent',
  description: 'Delegate a bounded task to an enabled temporary Agent Profile. Prefer explore for focused read-only repository discovery before implementation decisions, including locating files, searching source, tracing call chains, finding related tests/docs/wiki pages, and impact analysis. Use general for bounded complex multi-step implementation or broader independent work. Custom profiles can also be enabled as subagents. Subagents are short-lived and do not receive MCP or Agent Skill tools.',
  parameters: Type.Object({
    subagent: Type.String({ description: 'Agent Profile name to invoke.' }),
    task: Type.String({ description: 'Concrete, bounded task for the subagent. Do not delegate vague or open-ended work.' }),
    context: Type.Optional(Type.String({ description: 'Relevant context from the parent conversation or current plan. Keep this focused.' })),
    expectedOutput: Type.Optional(Type.String({ description: 'Optional output requirements for the subagent result.' })),
  }),
}

export const workspaceTools = [
  subagentTool,
  {
    name: 'read_file',
    label: 'Read file',
    description: 'Read a UTF-8 text file inside the project bound to this chat. Use offset and limit for large files.',
    parameters: Type.Object({
      path: Type.String({ description: 'File path relative to the workspace root.' }),
      offset: Type.Optional(Type.Number({ description: '1-based line offset.', default: 1 })),
      limit: Type.Optional(Type.Number({ description: 'Maximum number of lines to return.', default: 200 })),
    }),
  },
  {
    name: 'grep_files',
    label: 'Search files',
    description: 'Search project files using bundled ripgrep when available. Supports plain text, regex, glob filters, context lines, and file-only match output. Returns matching file paths and line numbers.',
    parameters: Type.Object({
      query: Type.String({ description: 'Plain text or regular expression to search for.' }),
      path: Type.Optional(Type.String({ description: 'Directory path relative to the workspace root. Defaults to .', default: '.' })),
      regex: Type.Optional(Type.Boolean({ description: 'Treat query as a regular expression.', default: false })),
      caseSensitive: Type.Optional(Type.Boolean({ description: 'Use case-sensitive matching.', default: false })),
      limit: Type.Optional(Type.Number({ description: 'Maximum matches to return.', default: 200 })),
      glob: Type.Optional(Type.Array(Type.String({ description: 'Ripgrep glob patterns, for example ["*.ts", "*.tsx", "!docs/**"].' }))),
      context: Type.Optional(Type.Number({ description: 'Number of context lines before and after each match. Uses ripgrep when available.', default: 0 })),
      beforeContext: Type.Optional(Type.Number({ description: 'Number of context lines before each match. Uses ripgrep when available.', default: 0 })),
      afterContext: Type.Optional(Type.Number({ description: 'Number of context lines after each match. Uses ripgrep when available.', default: 0 })),
      filesWithMatches: Type.Optional(Type.Boolean({ description: 'Only return file paths that contain matches.', default: false })),
      respectGitIgnore: Type.Optional(Type.Boolean({ description: 'Respect .gitignore and ripgrep ignore rules. Defaults to false to preserve QuickForge legacy search behavior.', default: false })),
    }),
  },
  {
    name: 'write_file',
    label: 'Write file',
    description: 'Create or overwrite a UTF-8 text file inside the project bound to this chat.',
    parameters: Type.Object({
      path: Type.String({ description: 'File path relative to the workspace root.' }),
      content: Type.String({ description: 'Complete file content to write.' }),
    }),
    executionMode: 'sequential',
  },
  {
    name: 'edit_file',
    label: 'Edit file',
    description: 'Edit a text file in the project bound to this chat by replacing exact text. oldText must match exactly once.',
    parameters: Type.Object({
      path: Type.String({ description: 'File path relative to the workspace root.' }),
      oldText: Type.String({ description: 'Exact existing text to replace. Must be unique in the file.' }),
      newText: Type.String({ description: 'Replacement text.' }),
    }),
    executionMode: 'sequential',
  },
  {
    name: 'run_command',
    label: 'Run command',
    description: 'Run a shell command in the project bound to this chat. Use this for lint, build, tests, git status, and diagnostics.',
    parameters: Type.Object({
      command: Type.String({ description: 'Command to execute in the workspace.' }),
      timeoutMs: Type.Optional(Type.Number({ description: 'Command timeout in milliseconds. Defaults to 30 minutes and is clamped to the supported range.', default: 1800000 })),
      description: Type.Optional(Type.String({ description: 'Short explanation of why this command is being run.' })),
    }),
    executionMode: 'sequential',
  },
]

function activeSkillSchema(skills) {
  const names = skills.map((skill) => skill.name).filter(Boolean)
  return names.length ? Type.String({ enum: names }) : Type.String()
}

export async function createSkillTools(config = {}) {
  const globalSkills = await loadSelectedGlobalSkills(config.globalSkillNames)
  const projectSkills = config.workspaceRoot
    ? await loadSelectedProjectSkills(config.projectSkillNames, config.workspaceRoot)
    : []
  const skills = mergeSkills(globalSkills, projectSkills)
  if (skills.length === 0) return []

  const skillNameSchema = activeSkillSchema(skills)
  return [
    {
      name: 'activate_skill',
      label: 'Activate skill',
      description: 'Load the full instructions for an enabled Agent Skill when the current task matches its description.',
      parameters: Type.Object({
        name: skillNameSchema,
      }),
    },
    {
      name: 'read_skill_resource',
      label: 'Read skill resource',
      description: 'Read a text resource bundled with an activated Agent Skill. Paths are relative to that skill directory.',
      parameters: Type.Object({
        skill: skillNameSchema,
        path: Type.String({ description: 'Relative path inside the skill directory, for example references/REFERENCE.md or scripts/helper.py.' }),
        offset: Type.Optional(Type.Number({ description: '1-based line offset.', default: 1 })),
        limit: Type.Optional(Type.Number({ description: 'Maximum number of lines to return.', default: 200 })),
      }),
    },
  ]
}
