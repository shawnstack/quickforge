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

export const workspaceTools = [
  {
    name: 'get_project_info',
    label: 'Project info',
    description: 'Get the project directory bound to this chat.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'list_dir',
    label: 'List directory',
    description: 'List files and folders inside the project bound to this chat. Paths are relative to that project root.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path relative to the workspace root. Defaults to .', default: '.' },
      },
    },
  },
  {
    name: 'read_file',
    label: 'Read file',
    description: 'Read a UTF-8 text file inside the project bound to this chat. Use offset and limit for large files.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the workspace root.' },
        offset: { type: 'number', description: '1-based line offset.', default: 1 },
        limit: { type: 'number', description: 'Maximum number of lines to return.', default: 200 },
      },
      required: ['path'],
    },
  },
  {
    name: 'grep_files',
    label: 'Search files',
    description: 'Search text in the project files bound to this chat. Returns matching file paths and line numbers.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Plain text or regular expression to search for.' },
        path: { type: 'string', description: 'Directory path relative to the workspace root. Defaults to .', default: '.' },
        regex: { type: 'boolean', description: 'Treat query as a regular expression.', default: false },
        caseSensitive: { type: 'boolean', description: 'Use case-sensitive matching.', default: false },
        limit: { type: 'number', description: 'Maximum matches to return.', default: 200 },
      },
      required: ['query'],
    },
  },
  {
    name: 'write_file',
    label: 'Write file',
    description: 'Create or overwrite a UTF-8 text file inside the project bound to this chat.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the workspace root.' },
        content: { type: 'string', description: 'Complete file content to write.' },
      },
      required: ['path', 'content'],
    },
    executionMode: 'sequential',
  },
  {
    name: 'edit_file',
    label: 'Edit file',
    description: 'Edit a text file in the project bound to this chat by replacing exact text. oldText must match exactly once.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the workspace root.' },
        oldText: { type: 'string', description: 'Exact existing text to replace. Must be unique in the file.' },
        newText: { type: 'string', description: 'Replacement text.' },
      },
      required: ['path', 'oldText', 'newText'],
    },
    executionMode: 'sequential',
  },
  {
    name: 'run_command',
    label: 'Run command',
    description: 'Run a shell command in the project bound to this chat. Use this for lint, build, tests, git status, and diagnostics.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to execute in the workspace.' },
        timeoutSeconds: { type: 'number', description: 'Timeout in seconds. Defaults to 60.', default: 60 },
      },
      required: ['command'],
    },
    executionMode: 'sequential',
  },
]
