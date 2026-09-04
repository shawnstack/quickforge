import { Type } from 'typebox'
import { loadSelectedGlobalSkills, loadSelectedProjectSkills, mergeSkills } from '../skills.mjs'

const temporarySubagentSchema = Type.Object({
  type: Type.Literal('temporary'),
  name: Type.String({ description: 'Temporary subagent name, lowercase ASCII identifier.' }),
  label: Type.Optional(Type.String({ description: 'Optional display name.' })),
  description: Type.Optional(Type.String({ description: 'Short description of the temporary subagent.' })),
  instructions: Type.String({ description: 'System instructions for the temporary subagent.' }),
  capabilityPolicy: Type.Optional(Type.String({ description: 'Capability policy, defaults to readonly-research.' })),
  tools: Type.Optional(Type.Array(Type.String({ description: 'Requested built-in tool names, constrained by capabilityPolicy.' }))),
  model: Type.Optional(Type.Any({ description: 'Model reference. Omit or use { mode: "inherit" } to inherit the parent model.' })),
  maxRuntimeMs: Type.Optional(Type.Number({ description: 'Optional max runtime in milliseconds.' })),
  maxToolCalls: Type.Optional(Type.Number({ description: 'Optional max tool-call budget.' })),
  allowMcpTools: Type.Optional(Type.Boolean({ description: 'Allow MCP tools inherited from the parent session.' })),
  allowAgentSkills: Type.Optional(Type.Boolean({ description: 'Allow Agent Skills inherited from the parent session.' })),
})

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
  description: 'Delegate a bounded task to an enabled temporary Agent Profile. Prefer explore for focused read-only repository discovery before implementation decisions, including locating files, searching source, tracing call chains, finding related tests/docs/wiki pages, and impact analysis. Use general for bounded complex multi-step implementation or broader independent work. Custom profiles can also be enabled as subagents. Subagents inherit the parent session MCP and Agent Skill tools only when the selected Profile explicitly allows them.',
  parameters: Type.Object({
    subagent: Type.Union([
      Type.String({ description: 'Agent Profile name to invoke.' }),
      temporarySubagentSchema,
    ], { description: 'Agent Profile name or an inline temporary subagent spec to create and run once.' }),
    task: Type.String({ description: 'Concrete, bounded task for the subagent. Do not delegate vague or open-ended work.' }),
    context: Type.Optional(Type.String({ description: 'Relevant context from the parent conversation or current plan. Keep this focused.' })),
    expectedOutput: Type.Optional(Type.String({ description: 'Optional output requirements for the subagent result.' })),
  }),
}

export const globalMemoryTool = {
  name: 'manage_global_memory',
  label: 'Manage global memory',
  description: 'Read or replace the complete global MEMORY.md shared by all chats. The document is free-form Markdown. When memory is enabled, proactively save durable preferences, habits, background, workflows, or goals when they are likely to help in future conversations, and honor explicit requests to remember, change, or forget information. Do not save current-task instructions, transient project details, single-action inferences, uncertain speculation, credentials, or secrets. Do not force an update when nothing meaningful changed. Before writing, read the current document, deduplicate or update conflicting information, preserve unrelated content and formatting, and submit the complete updated Markdown.',
  parameters: Type.Object({
    action: Type.Union([
      Type.Literal('read'),
      Type.Literal('write'),
    ], { description: 'Read the complete document or replace it with complete updated Markdown.' }),
    markdown: Type.Optional(Type.String({ description: 'Complete MEMORY.md content. Required for write; saved exactly as provided.' })),
  }),
  executionMode: 'sequential',
}

export const askUserTool = {
  name: 'ask_user',
  label: 'Ask user',
  description: 'Ask the user one or more questions (up to 4) and wait for their answers before continuing. Use this when you need the user to choose between approaches, confirm a direction, or supply information you cannot infer. Questions should be self-contained; each question offers 2-4 options and the user may answer with free-form text instead. All questions are answered together, then the run resumes.',
  parameters: Type.Object({
    questions: Type.Array(Type.Object({
      question: Type.String({ description: 'Complete, self-contained question text.' }),
      options: Type.Optional(Type.Array(Type.Object({
        label: Type.String({ description: 'Concise option label.' }),
        description: Type.Optional(Type.String({ description: 'Optional one-line explanation of the trade-off.' })),
      }), { maxItems: 4, description: '2-4 mutually exclusive options.' })),
      multiSelect: Type.Optional(Type.Boolean({ description: 'Allow selecting multiple options.', default: false })),
      allowCustom: Type.Optional(Type.Boolean({ description: 'Allow a free-form answer instead of the options.', default: true })),
    }), { minItems: 1, maxItems: 4, description: 'Questions asked together in one card; the user answers all of them in one pass.' }),
  }),
}

export const todoWriteTool = {
  name: 'todo_write',
  label: 'Update todos',
  description: 'Keep a short current plan for non-trivial multi-step tasks. Send the complete latest todo snapshot on every call, including completed items; use an empty array to clear it. Skip this tool for simple tasks. This records task state only and must not be used to hide reasoning.',
  parameters: Type.Object({
    todos: Type.Array(Type.Object({
      content: Type.String({ minLength: 1, maxLength: 200, description: 'Concise todo item text.' }),
      status: Type.Union([
        Type.Literal('pending'),
        Type.Literal('in_progress'),
        Type.Literal('completed'),
      ], { description: 'Current todo status.' }),
    }, { additionalProperties: false }), { maxItems: 20, description: 'Complete latest todo snapshot. May be empty to clear the list.' }),
  }, { additionalProperties: false }),
  executionMode: 'sequential',
}

export const workspaceTools = [
  subagentTool,
  askUserTool,
  todoWriteTool,
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
      timeoutMs: Type.Optional(Type.Number({ description: 'Command timeout in milliseconds. Defaults to 1 hour and is clamped to the supported range.', default: 3600000 })),
      description: Type.Optional(Type.String({ description: 'Short explanation of why this command is being run.' })),
    }),
    executionMode: 'sequential',
  },
  {
    name: 'present_files',
    label: 'Present files',
    description: 'Present one or more AI-produced artifact files only when the user is likely to benefit from inspecting the actual deliverable directly. Use it for visual outputs, reports, documents, generated assets, or when the user explicitly asks to view or review a file. Source code and configuration files should only be presented when they are themselves the requested deliverable or the user asks to inspect them. Do not present routine implementation changes, test files, supporting code, or large sets of modified files merely because they were edited. Prefer a small, relevant selection. HTML and supported images open in Browser; Markdown, code, configuration, and text files open in Reader; PDF, DOCX, and Excel files open in Document preview. Unsupported files remain available in the artifact list.',
    parameters: Type.Object({
      files: Type.Array(Type.Union([
        Type.String({ description: 'File path relative to the workspace root.' }),
        Type.Object({
          path: Type.String({ description: 'File path relative to the workspace root.' }),
          title: Type.Optional(Type.String({ description: 'Optional display title.' })),
          description: Type.Optional(Type.String({ description: 'Optional short description shown in artifact lists.' })),
          kind: Type.Optional(Type.String({ description: 'Optional file kind hint, such as html, image, markdown, code, pdf, docx, or excel.' })),
          preview: Type.Optional(Type.Boolean({ description: 'Whether this file may be opened automatically. Set false to list it without opening it.' })),
        }),
      ]), { description: 'Artifact files to present.' }),
      defaultPreview: Type.Optional(Type.String({ description: 'File path to open as the default preview when multiple files are presented.' })),
    }),
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
