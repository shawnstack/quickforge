import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getEnabledPluginCommandSources } from './plugins/registry.mjs'
import { userCommandsDir } from './storage.mjs'

const commandsRelativeDirs = ['.claude/commands', '.opencode/commands', '.ai/commands']
const commandsRelativeDir = '.ai/commands'
const commandNamePattern = /^(?!.*--)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

/**
 * Centralized metadata for all built-in slash commands.
 * This is the single source of truth used by /help output.
 * Front-end i18n descriptions (i18n.ts) should be kept in sync with the
 * `description` values here.
 */
const builtinCommandCatalog = [
  {
    name: 'plan',
    description: 'Create a plan first; this turn cannot edit files or run commands.',
    argumentHint: '[task]',
    permissionNote: 'read-only',
  },
  {
    name: 'review',
    description: 'Review pending code changes before commit; this turn cannot edit files.',
    argumentHint: '[scope]',
    permissionNote: 'no edits',
  },
  {
    name: 'summary',
    description: 'Create a new chat with this conversation summarized to reduce context usage.',
    argumentHint: '',
  },
  {
    name: 'compact',
    description: 'Compact this conversation context in place using the same rolling summary as auto-compaction.',
    argumentHint: '',
  },
  {
    name: 'clear',
    description: 'Clear the current chat history and context without calling the model.',
    argumentHint: '',
  },
  {
    name: 'commands',
    description: 'List custom commands (project, user-level, and plugin).',
    argumentHint: '',
  },
  {
    name: 'command new',
    description: 'Create a project custom command template.',
    argumentHint: '<name>',
  },
  {
    name: 'help',
    aliases: ['?'],
    description: 'Show available commands and their usage.',
    argumentHint: '',
  },
]

function normalizeCommandName(value) {
  const name = String(value || '').trim().toLowerCase()
  return commandNamePattern.test(name) ? name : null
}

function commandDirectory(workspaceRoot) {
  return workspaceRoot ? path.join(path.resolve(workspaceRoot), commandsRelativeDir) : null
}

function configuredCommandDirectories(workspaceRoot, commandDir) {
  if (!workspaceRoot) return []
  return String(commandDir || '')
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item && !item.includes('\0'))
    .map((item) => path.isAbsolute(item) ? path.resolve(item) : path.resolve(workspaceRoot, item))
}

function commandDirectories(workspaceRoot, commandDir) {
  if (!workspaceRoot) return []

  const dirs = commandsRelativeDirs.map((dir) => path.join(path.resolve(workspaceRoot), dir))
  for (const configuredDir of configuredCommandDirectories(workspaceRoot, commandDir)) {
    if (!dirs.some((dir) => path.resolve(dir) === path.resolve(configuredDir))) {
      dirs.push(configuredDir)
    }
  }
  return dirs
}

function parseFrontmatter(text) {
  const normalized = String(text || '').replace(/^\uFEFF/, '')
  const match = normalized.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/)
  if (!match) return { metadata: {}, body: normalized.trim() }
  return {
    metadata: parseSimpleYamlMap(match[1]),
    body: match[2].trim(),
  }
}

function stripInlineComment(value) {
  const trimmed = value.trim()
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) return trimmed
  const index = trimmed.indexOf(' #')
  return index >= 0 ? trimmed.slice(0, index).trimEnd() : trimmed
}

function parseYamlScalar(value) {
  const trimmed = stripInlineComment(String(value ?? ''))
  if (!trimmed) return ''
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
  }
  return trimmed
}

function parseSimpleYamlMap(text) {
  const result = {}
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || /^\s/.test(line)) continue

    const match = line.match(/^([A-Za-z0-9_.-]+):(?:\s*(.*))?$/)
    if (!match) continue
    const [, key, rawValue = ''] = match
    result[key] = parseYamlScalar(rawValue)
  }
  return result
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function firstOptionalBoolean(...values) {
  for (const value of values) {
    if (value === true || value === false) return value
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase()
      if (normalized === 'true') return true
      if (normalized === 'false') return false
    }
  }
  return undefined
}

export function commandFromFile(file, text, options = {}) {
  const parsed = parseFrontmatter(text)
  if (!parsed.body) return null

  const fallbackName = normalizeCommandName(path.basename(file, '.md'))
  const declaredName = normalizeCommandName(parsed.metadata.name)
  const name = declaredName || fallbackName
  if (!name) return null

  return {
    name,
    description: firstString(parsed.metadata.description),
    argumentHint: firstString(parsed.metadata['argument-hint'], parsed.metadata.argument_hint),
    allowEdit: firstOptionalBoolean(
      parsed.metadata.allow_edit,
      parsed.metadata['allow-edit'],
      parsed.metadata.allowEdit,
    ),
    allowCommands: firstOptionalBoolean(
      parsed.metadata.allow_commands,
      parsed.metadata['allow-commands'],
      parsed.metadata.allowCommands,
    ),
    body: parsed.body,
    filePath: file,
    relativePath: options.relativePath || path.relative(path.dirname(path.dirname(file)), file).replace(/\\/g, '/'),
    source: options.source,
    pluginName: options.pluginName,
  }
}

export function parseSlashInvocationText(text) {
  const normalized = String(text || '').trim()
  const match = normalized.match(/^\/([A-Za-z0-9][A-Za-z0-9-]*)(?:\s+([\s\S]*))?$/)
  if (!match) return null

  const name = normalizeCommandName(match[1])
  if (!name) return null

  return {
    name,
    arguments: (match[2] || '').trim(),
  }
}

export function textFromUserMessage(message) {
  if (typeof message === 'string') return message
  if (!message || typeof message !== 'object') return ''

  const content = message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .filter((block) => block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

async function listCommandsFromDirectory(dir, options = {}) {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR' || error?.code === 'EACCES' || error?.code === 'EPERM') return []
    throw error
  }

  const commands = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue
    const file = path.join(dir, entry.name)
    try {
      const relativePath = options.relativeRoot
        ? `${options.relativeRoot}/${entry.name}`.replace(/\\/g, '/')
        : undefined
      const command = commandFromFile(file, await fs.readFile(file, 'utf8'), {
        source: options.source,
        pluginName: options.pluginName,
        relativePath,
      })
      if (command) commands.push(command)
    } catch (error) {
      console.warn(`Failed to load custom command ${file}:`, error.message || error)
    }
  }

  return commands
}

async function listCommandsFromFile(file, options = {}) {
  if (!file.toLowerCase().endsWith('.md')) return []
  try {
    const command = commandFromFile(file, await fs.readFile(file, 'utf8'), options)
    return command ? [command] : []
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR' || error?.code === 'EACCES' || error?.code === 'EPERM') return []
    console.warn(`Failed to load custom command ${file}:`, error.message || error)
    return []
  }
}

async function listCommandsFromPluginSource(source) {
  const stat = await fs.stat(source.path).catch(() => null)
  if (!stat) return []
  const options = {
    source: source.source,
    pluginName: source.pluginName,
    relativePath: source.relativePath,
    relativeRoot: source.relativePath,
  }
  if (stat.isFile()) return listCommandsFromFile(source.path, options)
  if (stat.isDirectory()) return listCommandsFromDirectory(source.path, options)
  return []
}

async function listPluginCommands(workspaceRoot) {
  if (!workspaceRoot) return []
  const sources = await getEnabledPluginCommandSources({ workspaceRoot })
  const commands = []
  for (const source of sources) {
    commands.push(...await listCommandsFromPluginSource(source))
  }
  return commands
}

async function listUserCommands() {
  return listCommandsFromDirectory(userCommandsDir, {
    source: 'user',
    relativeRoot: '~/.quickforge/commands',
  })
}

export async function listProjectCommands(workspaceRoot, commandDir) {
  const byName = new Map()

  // 1. Plugin commands (lowest priority)
  for (const command of (await listPluginCommands(workspaceRoot)).sort((a, b) => a.name.localeCompare(b.name))) {
    byName.set(command.name, command)
  }

  // 2. User-level commands (~/.quickforge/commands/) — override plugins, overridden by project
  for (const command of (await listUserCommands()).sort((a, b) => a.name.localeCompare(b.name))) {
    byName.set(command.name, command)
  }

  // 3. Project directories: .claude → .opencode → .ai → configured (highest priority)
  for (const dir of commandDirectories(workspaceRoot, commandDir)) {
    const commands = await listCommandsFromDirectory(dir)
    for (const command of commands.sort((a, b) => a.name.localeCompare(b.name))) {
      byName.set(command.name, command)
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export async function findProjectCommand(workspaceRoot, commandName, commandDir) {
  const name = normalizeCommandName(commandName)
  if (!name) return null
  const commands = await listProjectCommands(workspaceRoot, commandDir)
  return commands.find((command) => command.name === name) || null
}

export async function resolveCustomCommandInvocation(message, workspaceRoot, commandDir) {
  const invocation = parseSlashInvocationText(textFromUserMessage(message))
  if (!invocation) return null

  const command = await findProjectCommand(workspaceRoot, invocation.name, commandDir)
  if (!command) return null

  const expandedBody = command.body.replace(/\$ARGUMENTS/g, invocation.arguments)
  const permissions = {
    allowEdit: command.allowEdit !== false,
    allowCommands: command.allowCommands !== false,
  }

  return {
    command,
    arguments: invocation.arguments,
    permissions,
    systemPrompt: formatCommandSystemPrompt(command, invocation.arguments, expandedBody),
  }
}

function formatCommandSystemPrompt(command, args, expandedBody) {
  const argsBlock = args || '(none)'
  return `<custom_command_invocation name="${escapeXml(command.name)}" source="${escapeXml(command.relativePath)}">
This custom command applies only to the current user request. Follow it unless it conflicts with higher-priority system, safety, user, or project instructions.

Arguments:
${argsBlock}

Instructions:
${expandedBody}
</custom_command_invocation>`
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function parseInternalCommandInvocation(message) {
  const text = textFromUserMessage(message).trim()
  if (/^\/(?:help|\?)(?:\s+.*)?$/i.test(text)) return { type: 'help' }
  if (/^\/commands(?:\s+.*)?$/i.test(text)) return { type: 'list' }
  if (/^\/clear\s*$/i.test(text)) return { type: 'clear' }
  if (/^\/clear(?:\s+[\s\S]+)$/i.test(text)) return { type: 'invalid-clear-args' }

  const planMatch = text.match(/^\/plan(?:\s+([\s\S]*))?$/i)
  if (planMatch) return { type: 'plan', args: (planMatch[1] || '').trim() }

  const reviewMatch = text.match(/^\/review(?:\s+([\s\S]*))?$/i)
  if (reviewMatch) return { type: 'review', args: (reviewMatch[1] || '').trim() }

  const compactMatch = text.match(/^\/compact(?:\s+([\s\S]*))?$/i)
  if (compactMatch) return { type: 'compact', args: (compactMatch[1] || '').trim() }

  const summaryMatch = text.match(/^\/summary(?:\s+([\s\S]*))?$/i)
  if (summaryMatch) return { type: 'summary', args: (summaryMatch[1] || '').trim() }

  const createMatch = text.match(/^\/command\s+new\s+([A-Za-z0-9][A-Za-z0-9-]*)\s*$/i)
  if (createMatch) {
    const name = normalizeCommandName(createMatch[1])
    return name ? { type: 'new', name } : { type: 'invalid-name', name: createMatch[1] }
  }

  return null
}

export async function handleInternalCommand(invocation, workspaceRoot, commandDir) {
  if (!invocation) return null

  if (invocation.type === 'compact') {
    return { compact: true, args: invocation.args || '' }
  }

  if (invocation.type === 'summary') {
    return { summary: true, args: invocation.args || '' }
  }

  if (invocation.type === 'plan') {
    if (!invocation.args) return 'Usage: /plan <task>'
    return { plan: true, args: invocation.args }
  }

  if (invocation.type === 'review') {
    if (!workspaceRoot) return 'Review requires an active project chat.'
    return { review: true, args: invocation.args || '' }
  }

  if (invocation.type === 'clear') {
    return { clear: true }
  }

  if (invocation.type === 'invalid-clear-args') {
    return 'Usage: /clear'
  }

  if (invocation.type === 'help') {
    return formatHelpText(await listProjectCommands(workspaceRoot, commandDir))
  }

  // /commands and /help work without a project (user-level commands are global)
  if (invocation.type === 'list') {
    return formatCommandList(await listProjectCommands(workspaceRoot, commandDir))
  }

  if (!workspaceRoot) {
    return 'Custom commands require an active project chat.'
  }

  if (invocation.type === 'new') {
    return createCommandTemplate(workspaceRoot, invocation.name)
  }

  if (invocation.type === 'invalid-name') {
    return `Invalid command name: ${invocation.name}\n\nUse lowercase letters, numbers, and hyphens, for example: review or fix-bug.`
  }

  return null
}

function formatPermission(value) {
  return value === false ? 'false' : 'true'
}

export function formatCommandList(commands) {
  if (commands.length === 0) {
    return [
      'No custom commands found.',
      '',
      'Create one with:',
      '```text',
      '/command new review',
      '```',
      '',
      'Or add Markdown files under `~/.quickforge/commands/` (user-level), or `.claude/commands/`, `.opencode/commands/`, `.ai/commands/` (project-level), for example `.ai/commands/review.md`.',
    ].join('\n')
  }

  const rows = commands.map((command) => {
    const hint = command.argumentHint ? ` ${command.argumentHint}` : ''
    const description = command.description ? ` — ${command.description}` : ''
    const permissions = `allow_edit=${formatPermission(command.allowEdit)} allow_commands=${formatPermission(command.allowCommands)}`
    return `- \`/${command.name}${hint}\`${description} (${permissions})`
  })

  return [
    'Custom commands:',
    '',
    ...rows,
    '',
    'Command files live in `~/.quickforge/commands/*.md` (user-level), `.claude/commands/*.md`, `.opencode/commands/*.md`, `.ai/commands/*.md`, or configured directories. Use `$ARGUMENTS` inside a command file to insert invocation arguments.',
  ].join('\n')
}

function formatBuiltinCommandRows() {
  return builtinCommandCatalog.map((cmd) => {
    const hint = cmd.argumentHint ? ` ${cmd.argumentHint}` : ''
    const aliases = cmd.aliases?.length
      ? ` (alias: ${cmd.aliases.map((alias) => `/${alias}`).join(', ')})`
      : ''
    const perm = cmd.permissionNote ? ` \[${cmd.permissionNote}\]` : ''
    return `- \`/${cmd.name}${hint}\`${aliases} — ${cmd.description}${perm}`
  })
}

export function formatHelpText(customCommands = []) {
  const sections = [
    'QuickForge command reference',
    '',
    'Built-in commands:',
    '',
    ...formatBuiltinCommandRows(),
  ]

  if (customCommands.length > 0) {
    sections.push('', formatCommandList(customCommands))
  } else {
    sections.push(
      '',
      'No custom commands found. Add Markdown files under `~/.quickforge/commands/` (user-level) or `.claude/commands/`, `.opencode/commands/`, `.ai/commands/` (project-level).',
    )
  }

  return sections.join('\n')
}

async function createCommandTemplate(workspaceRoot, name) {
  const result = await createCommandFile(workspaceRoot, name)
  if (result.ok) {
    return [
      `Created custom command: ${result.relativePath}`,
      '',
      `Run it with: /${result.name} your arguments`,
    ].join('\n')
  }
  if (result.reason === 'exists') {
    return `Custom command already exists: ${commandsRelativeDir}/${result.name}.md`
  }
  return `Invalid command name: ${name}\n\nUse lowercase letters, numbers, and hyphens.`
}

function commandTemplate(name) {
  return `---
name: ${name}
description: Describe when to use this command.
argument-hint: "[arguments]"
allow_edit: false
allow_commands: false
---

请根据以下参数执行任务：

$ARGUMENTS
`
}

export async function createCommandFile(workspaceRoot, name) {
  const commandName = normalizeCommandName(name)
  if (!commandName) {
    return { ok: false, reason: 'invalid' }
  }
  const dir = commandDirectory(workspaceRoot)
  if (!dir) {
    return { ok: false, reason: 'no-project' }
  }
  const file = path.join(dir, `${commandName}.md`)
  try {
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(file, commandTemplate(commandName), { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    if (error?.code === 'EEXIST') {
      return { ok: false, reason: 'exists', name: commandName, filePath: file }
    }
    throw error
  }
  return {
    ok: true,
    name: commandName,
    filePath: file,
    relativePath: `${commandsRelativeDir}/${commandName}.md`,
  }
}
