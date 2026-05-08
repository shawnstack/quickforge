import { promises as fs } from 'node:fs'
import path from 'node:path'

const commandsRelativeDir = '.ai/commands'
const commandNamePattern = /^(?!.*--)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

function normalizeCommandName(value) {
  const name = String(value || '').trim().toLowerCase()
  return commandNamePattern.test(name) ? name : null
}

function commandDirectory(workspaceRoot) {
  return workspaceRoot ? path.join(path.resolve(workspaceRoot), commandsRelativeDir) : null
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

function commandFromFile(file, text) {
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
    relativePath: path.relative(path.dirname(path.dirname(file)), file).replace(/\\/g, '/'),
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

export async function listProjectCommands(workspaceRoot) {
  const dir = commandDirectory(workspaceRoot)
  if (!dir) return []

  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }

  const commands = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue
    const file = path.join(dir, entry.name)
    try {
      const command = commandFromFile(file, await fs.readFile(file, 'utf8'))
      if (command) commands.push(command)
    } catch (error) {
      console.warn(`Failed to load custom command ${file}:`, error.message || error)
    }
  }

  const byName = new Map()
  for (const command of commands.sort((a, b) => a.name.localeCompare(b.name))) {
    byName.set(command.name, command)
  }
  return [...byName.values()]
}

export async function findProjectCommand(workspaceRoot, commandName) {
  const name = normalizeCommandName(commandName)
  if (!name) return null
  const commands = await listProjectCommands(workspaceRoot)
  return commands.find((command) => command.name === name) || null
}

export async function resolveCustomCommandInvocation(message, workspaceRoot) {
  const invocation = parseSlashInvocationText(textFromUserMessage(message))
  if (!invocation) return null

  const command = await findProjectCommand(workspaceRoot, invocation.name)
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
  if (/^\/commands(?:\s+.*)?$/i.test(text)) return { type: 'list' }
  if (/^\/clear\s*$/i.test(text)) return { type: 'clear' }
  if (/^\/clear(?:\s+[\s\S]+)$/i.test(text)) return { type: 'invalid-clear-args' }

  const compactMatch = text.match(/^\/compact(?:\s+([\s\S]*))?$/i)
  if (compactMatch) return { type: 'compact', args: (compactMatch[1] || '').trim() }

  const createMatch = text.match(/^\/command\s+new\s+([A-Za-z0-9][A-Za-z0-9-]*)\s*$/i)
  if (createMatch) {
    const name = normalizeCommandName(createMatch[1])
    return name ? { type: 'new', name } : { type: 'invalid-name', name: createMatch[1] }
  }

  return null
}

export async function handleInternalCommand(invocation, workspaceRoot) {
  if (!invocation) return null

  if (invocation.type === 'compact') {
    return { compact: true, args: invocation.args || '' }
  }

  if (invocation.type === 'clear') {
    return { clear: true }
  }

  if (invocation.type === 'invalid-clear-args') {
    return 'Usage: /clear'
  }

  if (!workspaceRoot) {
    return 'Custom commands require an active project chat.'
  }

  if (invocation.type === 'list') {
    return formatCommandList(await listProjectCommands(workspaceRoot))
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

function formatCommandList(commands) {
  if (commands.length === 0) {
    return [
      'No project custom commands found.',
      '',
      'Create one with:',
      '```text',
      '/command new review',
      '```',
      '',
      'Or add Markdown files under `.ai/commands/`, for example `.ai/commands/review.md`.',
    ].join('\n')
  }

  const rows = commands.map((command) => {
    const hint = command.argumentHint ? ` ${command.argumentHint}` : ''
    const description = command.description ? ` — ${command.description}` : ''
    const permissions = `allow_edit=${formatPermission(command.allowEdit)} allow_commands=${formatPermission(command.allowCommands)}`
    return `- \`/${command.name}${hint}\`${description} (${permissions})`
  })

  return [
    'Project custom commands:',
    '',
    ...rows,
    '',
    'Command files live in `.ai/commands/*.md`. Use `$ARGUMENTS` inside a command file to insert invocation arguments.',
  ].join('\n')
}

async function createCommandTemplate(workspaceRoot, name) {
  const commandName = normalizeCommandName(name)
  if (!commandName) {
    return `Invalid command name: ${name}\n\nUse lowercase letters, numbers, and hyphens.`
  }

  const dir = commandDirectory(workspaceRoot)
  const file = path.join(dir, `${commandName}.md`)
  try {
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(file, commandTemplate(commandName), { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    if (error?.code === 'EEXIST') {
      return `Custom command already exists: ${commandsRelativeDir}/${commandName}.md`
    }
    throw error
  }

  return [
    `Created custom command: ${commandsRelativeDir}/${commandName}.md`,
    '',
    `Run it with: /${commandName} your arguments`,
  ].join('\n')
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
