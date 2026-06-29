export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function buildInlinePreview(text: string): string {
  return text.split('\n').map((line) => {
    const safeLine = escapeHtml(line)
    if (line.startsWith('+')) return `<span style="color:rgb(22 101 52);background:rgba(34,197,94,.14);display:block;">${safeLine}</span>`
    if (line.startsWith('-')) return `<span style="color:rgb(153 27 27);background:rgba(239,68,68,.12);display:block;">${safeLine}</span>`
    if (line.startsWith('@@')) return `<span style="color:rgb(37 99 235);background:rgba(37,99,235,.10);display:block;">${safeLine}</span>`
    return `<span style="display:block;">${safeLine || ' '}</span>`
  }).join('\n')
}

export function buildInlineDiff(oldText: string, newText: string): string {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const result: string[] = []
  for (const line of oldLines) {
    result.push(`<span style="color:rgb(153 27 27);background:rgba(239,68,68,.12);display:block;">- ${escapeHtml(line)}</span>`)
  }
  for (const line of newLines) {
    result.push(`<span style="color:rgb(22 101 52);background:rgba(34,197,94,.14);display:block;">+ ${escapeHtml(line)}</span>`)
  }
  return result.join('\n')
}
