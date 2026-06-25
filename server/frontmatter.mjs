function leadingIndent(line) {
  const match = String(line || '').match(/^\s*/)
  return match ? match[0].length : 0
}

function stripInlineComment(value) {
  const trimmed = String(value ?? '').trim()
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) return trimmed
  const index = trimmed.indexOf(' #')
  return index >= 0 ? trimmed.slice(0, index).trimEnd() : trimmed
}

export function parseYamlScalar(value, options = {}) {
  const trimmed = stripInlineComment(value)
  if (!trimmed) return ''
  if (options.booleans !== false) {
    const normalized = trimmed.toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }

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

function collectIndentedBlock(lines, startIndex, parentIndent) {
  const block = []
  let index = startIndex
  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) {
      block.push(line)
      index++
      continue
    }
    if (leadingIndent(line) <= parentIndent) break
    block.push(line)
    index++
  }
  return { block, nextIndex: index }
}

function parseBlockScalar(lines, style) {
  const nonEmpty = lines.filter((line) => line.trim())
  const minIndent = nonEmpty.length
    ? Math.min(...nonEmpty.map((line) => leadingIndent(line)))
    : 0
  const unindented = lines.map((line) => line.slice(Math.min(minIndent, line.length)))
  return style === '>'
    ? unindented.join(' ').replace(/\s+/g, ' ').trim()
    : unindented.join('\n').trim()
}

export function parseSimpleYamlMap(text, options = {}) {
  const result = {}
  const lines = String(text || '').split(/\r?\n/)
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || leadingIndent(line) > 0) {
      index++
      continue
    }

    const match = line.match(/^([A-Za-z0-9_.-]+):(?:\s*(.*))?$/)
    if (!match) {
      index++
      continue
    }

    const [, key, rawValue = ''] = match
    const value = rawValue.trim()

    if (value === '|' || value === '>') {
      const { block, nextIndex } = collectIndentedBlock(lines, index + 1, 0)
      result[key] = parseBlockScalar(block, value)
      index = nextIndex
      continue
    }

    if (value) {
      result[key] = parseYamlScalar(value, options)
      index++
      continue
    }

    const nested = {}
    let nestedIndex = index + 1
    while (nestedIndex < lines.length) {
      const nestedLine = lines[nestedIndex]
      const nestedTrimmed = nestedLine.trim()
      if (!nestedTrimmed || nestedTrimmed.startsWith('#')) {
        nestedIndex++
        continue
      }

      const indent = leadingIndent(nestedLine)
      if (indent <= 0) break

      const nestedMatch = nestedLine.slice(indent).match(/^([A-Za-z0-9_.-]+):(?:\s*(.*))?$/)
      if (!nestedMatch) {
        nestedIndex++
        continue
      }

      const [, nestedKey, nestedRawValue = ''] = nestedMatch
      nested[nestedKey] = parseYamlScalar(nestedRawValue.trim(), options)
      nestedIndex++
    }

    result[key] = Object.keys(nested).length ? nested : ''
    index = Object.keys(nested).length ? nestedIndex : index + 1
  }

  return result
}

export function parseFrontmatter(text, options = {}) {
  const normalized = String(text || '').replace(/^\uFEFF/, '')
  const match = normalized.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/)
  if (!match) {
    return options.requireFrontmatter ? null : { metadata: {}, frontmatter: '', body: normalized.trim() }
  }
  return {
    metadata: parseSimpleYamlMap(match[1], options),
    frontmatter: match[1],
    body: match[2].trim(),
  }
}

export function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

export function firstOptionalBoolean(...values) {
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

export function splitDelimitedList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean)
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}
