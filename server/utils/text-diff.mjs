const DEFAULT_CONTEXT_LINES = 3
const DEFAULT_MAX_DIFF_CHARS = 60000
const DEFAULT_MAX_DIFF_LINES = 1200
const MAX_LCS_CELLS = 2_000_000

function splitTextLines(text) {
  if (!text) return []
  const normalized = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

function countCommonPrefix(oldLines, newLines) {
  const limit = Math.min(oldLines.length, newLines.length)
  let index = 0
  while (index < limit && oldLines[index] === newLines[index]) index++
  return index
}

function countCommonSuffix(oldLines, newLines, prefixLength) {
  const oldRemaining = oldLines.length - prefixLength
  const newRemaining = newLines.length - prefixLength
  const limit = Math.min(oldRemaining, newRemaining)
  let count = 0
  while (count < limit && oldLines[oldLines.length - 1 - count] === newLines[newLines.length - 1 - count]) count++
  return count
}

function diffMiddleLines(oldLines, newLines) {
  const oldCount = oldLines.length
  const newCount = newLines.length

  if (oldCount === 0) return newLines.map((line) => ({ type: 'insert', line }))
  if (newCount === 0) return oldLines.map((line) => ({ type: 'delete', line }))

  if (oldCount * newCount > MAX_LCS_CELLS) {
    return [
      ...oldLines.map((line) => ({ type: 'delete', line })),
      ...newLines.map((line) => ({ type: 'insert', line })),
    ]
  }

  const dp = Array.from({ length: oldCount + 1 }, () => new Uint32Array(newCount + 1))
  for (let oldIndex = oldCount - 1; oldIndex >= 0; oldIndex--) {
    for (let newIndex = newCount - 1; newIndex >= 0; newIndex--) {
      dp[oldIndex][newIndex] = oldLines[oldIndex] === newLines[newIndex]
        ? dp[oldIndex + 1][newIndex + 1] + 1
        : Math.max(dp[oldIndex + 1][newIndex], dp[oldIndex][newIndex + 1])
    }
  }

  const operations = []
  let oldIndex = 0
  let newIndex = 0
  while (oldIndex < oldCount && newIndex < newCount) {
    if (oldLines[oldIndex] === newLines[newIndex]) {
      operations.push({ type: 'equal', line: oldLines[oldIndex] })
      oldIndex++
      newIndex++
    } else if (dp[oldIndex + 1][newIndex] >= dp[oldIndex][newIndex + 1]) {
      operations.push({ type: 'delete', line: oldLines[oldIndex] })
      oldIndex++
    } else {
      operations.push({ type: 'insert', line: newLines[newIndex] })
      newIndex++
    }
  }

  while (oldIndex < oldCount) {
    operations.push({ type: 'delete', line: oldLines[oldIndex] })
    oldIndex++
  }
  while (newIndex < newCount) {
    operations.push({ type: 'insert', line: newLines[newIndex] })
    newIndex++
  }

  return operations
}

function diffLineOperations(oldLines, newLines) {
  const prefixLength = countCommonPrefix(oldLines, newLines)
  const suffixLength = countCommonSuffix(oldLines, newLines, prefixLength)
  const oldMiddleEnd = oldLines.length - suffixLength
  const newMiddleEnd = newLines.length - suffixLength

  const operations = [
    ...oldLines.slice(0, prefixLength).map((line) => ({ type: 'equal', line })),
    ...diffMiddleLines(oldLines.slice(prefixLength, oldMiddleEnd), newLines.slice(prefixLength, newMiddleEnd)),
    ...oldLines.slice(oldMiddleEnd).map((line) => ({ type: 'equal', line })),
  ]

  let oldLine = 1
  let newLine = 1
  for (const operation of operations) {
    if (operation.type !== 'insert') {
      operation.oldLine = oldLine
      oldLine++
    } else {
      operation.oldLine = oldLine
    }

    if (operation.type !== 'delete') {
      operation.newLine = newLine
      newLine++
    } else {
      operation.newLine = newLine
    }
  }

  return operations
}

function changedOperationRanges(operations, contextLines) {
  const ranges = []
  let index = 0

  while (index < operations.length) {
    while (index < operations.length && operations[index].type === 'equal') index++
    if (index >= operations.length) break

    const changeStart = index
    while (index < operations.length && operations[index].type !== 'equal') index++
    const changeEnd = index - 1
    const start = Math.max(0, changeStart - contextLines)
    const end = Math.min(operations.length, changeEnd + contextLines + 1)

    const previous = ranges.at(-1)
    if (previous && start <= previous.end) {
      previous.end = end
    } else {
      ranges.push({ start, end })
    }
  }

  return ranges
}

function formatRange(start, count) {
  if (count === 0) return `${start},0`
  if (count === 1) return String(start)
  return `${start},${count}`
}

function hunkHeader(operations, oldLineCount) {
  const oldOperations = operations.filter((operation) => operation.type !== 'insert')
  const newOperations = operations.filter((operation) => operation.type !== 'delete')
  const firstOperation = operations[0]
  const oldStart = oldOperations[0]?.oldLine ?? (oldLineCount === 0 ? 0 : firstOperation?.oldLine ?? 1)
  const newStart = newOperations[0]?.newLine ?? (firstOperation?.newLine ?? 1)

  return `@@ -${formatRange(oldStart, oldOperations.length)} +${formatRange(newStart, newOperations.length)} @@`
}

function formatOperation(operation) {
  if (operation.type === 'insert') return `+${operation.line}`
  if (operation.type === 'delete') return `-${operation.line}`
  return ` ${operation.line}`
}

function truncateDiffText(text, maxChars, maxLines) {
  let truncated = false
  let output = text

  const lines = output.split('\n')
  if (lines.length > maxLines) {
    output = lines.slice(0, maxLines).join('\n')
    truncated = true
  }

  if (output.length > maxChars) {
    output = output.slice(0, maxChars)
    truncated = true
  }

  if (truncated) output = `${output}\n\n[diff truncated]`
  return { text: output, truncated }
}

export function createTextDiff(oldText, newText, relativePath, options = {}) {
  const oldLines = splitTextLines(oldText)
  const newLines = splitTextLines(newText)
  const operations = diffLineOperations(oldLines, newLines)
  const addedLines = operations.filter((operation) => operation.type === 'insert').length
  const removedLines = operations.filter((operation) => operation.type === 'delete').length
  const contextLines = Math.max(0, Number(options.contextLines ?? DEFAULT_CONTEXT_LINES))
  const ranges = changedOperationRanges(operations, contextLines)
  const oldLabel = options.oldExists === false ? '/dev/null' : `a/${relativePath}`
  const newLabel = `b/${relativePath}`

  const diffLines = ranges.length > 0 ? [`--- ${oldLabel}`, `+++ ${newLabel}`] : []
  for (const range of ranges) {
    const hunkOperations = operations.slice(range.start, range.end)
    diffLines.push(hunkHeader(hunkOperations, oldLines.length))
    diffLines.push(...hunkOperations.map(formatOperation))
  }

  const truncated = truncateDiffText(
    diffLines.join('\n'),
    Number(options.maxChars ?? DEFAULT_MAX_DIFF_CHARS),
    Number(options.maxLines ?? DEFAULT_MAX_DIFF_LINES),
  )

  return {
    format: 'unified',
    path: relativePath,
    addedLines,
    removedLines,
    oldLineCount: oldLines.length,
    newLineCount: newLines.length,
    truncated: truncated.truncated,
    text: truncated.text,
  }
}
