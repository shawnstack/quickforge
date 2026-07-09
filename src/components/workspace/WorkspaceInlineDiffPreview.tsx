import { ChevronDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { GitFileDiffResponse } from './workspace-types'

type DiffLine = {
  kind: 'context' | 'add' | 'delete'
  oldLine?: number
  newLine?: number
  text: string
}

type CollapsedDiffLine = {
  kind: 'collapsed'
  id: string
  count: number
  rows: DiffLine[]
}

type InlineDiffRow = DiffLine | CollapsedDiffLine

type WorkspaceInlineDiffPreviewProps = {
  diff?: GitFileDiffResponse
  loading?: boolean
  error?: string
}

const INLINE_DIFF_CONTEXT_RADIUS = 3
const INLINE_DIFF_MAX_CELLS = 10_000_000

function contentLines(content: string) {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

function buildDiffLines(oldContent: string, newContent: string): DiffLine[] | undefined {
  const oldLines = contentLines(oldContent)
  const newLines = contentLines(newContent)
  const cells = oldLines.length * newLines.length
  if (cells > INLINE_DIFF_MAX_CELLS) return undefined

  const table = Array.from({ length: oldLines.length + 1 }, () => new Uint32Array(newLines.length + 1))
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      table[oldIndex][newIndex] = oldLines[oldIndex] === newLines[newIndex]
        ? table[oldIndex + 1][newIndex + 1] + 1
        : Math.max(table[oldIndex + 1][newIndex], table[oldIndex][newIndex + 1])
    }
  }

  const rows: DiffLine[] = []
  let oldIndex = 0
  let newIndex = 0
  let oldLine = 1
  let newLine = 1
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (oldIndex < oldLines.length && newIndex < newLines.length && oldLines[oldIndex] === newLines[newIndex]) {
      rows.push({ kind: 'context', oldLine, newLine, text: oldLines[oldIndex] })
      oldIndex += 1
      newIndex += 1
      oldLine += 1
      newLine += 1
      continue
    }

    if (newIndex < newLines.length && (oldIndex >= oldLines.length || table[oldIndex][newIndex + 1] >= table[oldIndex + 1][newIndex])) {
      rows.push({ kind: 'add', newLine, text: newLines[newIndex] })
      newIndex += 1
      newLine += 1
      continue
    }

    if (oldIndex < oldLines.length) {
      rows.push({ kind: 'delete', oldLine, text: oldLines[oldIndex] })
      oldIndex += 1
      oldLine += 1
    }
  }

  return rows
}

function collapseUnmodifiedRows(rows: DiffLine[]) {
  const keep = rows.map((row) => row.kind !== 'context')
  rows.forEach((row, index) => {
    if (row.kind === 'context') return
    const start = Math.max(0, index - INLINE_DIFF_CONTEXT_RADIUS)
    const end = Math.min(rows.length - 1, index + INLINE_DIFF_CONTEXT_RADIUS)
    for (let current = start; current <= end; current += 1) keep[current] = true
  })

  const nextRows: InlineDiffRow[] = []
  let index = 0
  let collapsedIndex = 0
  while (index < rows.length) {
    if (keep[index] || rows[index].kind !== 'context') {
      nextRows.push(rows[index])
      index += 1
      continue
    }

    const start = index
    while (index < rows.length && !keep[index] && rows[index].kind === 'context') index += 1
    const hiddenRows = rows.slice(start, index)
    nextRows.push({
      kind: 'collapsed',
      id: `collapsed-${collapsedIndex++}-${start}`,
      count: hiddenRows.length,
      rows: hiddenRows,
    })
  }

  return nextRows
}

function lineClassName(kind: DiffLine['kind']) {
  if (kind === 'add') return 'bg-emerald-500/12 text-foreground'
  if (kind === 'delete') return 'bg-red-500/12 text-foreground'
  return 'bg-background text-foreground/90'
}

function linePrefix(kind: DiffLine['kind']) {
  if (kind === 'add') return '+'
  if (kind === 'delete') return '-'
  return ' '
}

function DiffContentLine({ row }: { row: DiffLine }) {
  const lineNumber = row.kind === 'delete' ? row.oldLine : row.newLine ?? row.oldLine
  return (
    <div className={cn('grid min-w-max grid-cols-[3rem_minmax(34rem,1fr)] text-[13px] leading-6', lineClassName(row.kind))}>
      <span className={cn('select-none pr-3 text-right font-mono', row.kind === 'delete' && 'text-red-600 dark:text-red-500', row.kind === 'add' && 'text-emerald-600 dark:text-emerald-500', row.kind === 'context' && 'text-muted-foreground/62')}>{lineNumber ?? ''}</span>
      <code className="whitespace-pre pr-4 font-mono">
        <span className={cn('mr-3 select-none', row.kind === 'add' && 'text-emerald-600 dark:text-emerald-500', row.kind === 'delete' && 'text-red-600 dark:text-red-500')}>{linePrefix(row.kind)}</span>
        {row.text || ' '}
      </code>
    </div>
  )
}

function toggleExpandedGroup(current: Record<string, string[]>, diffKey: string, id: string) {
  const currentGroups = new Set(current[diffKey] ?? [])
  if (currentGroups.has(id)) currentGroups.delete(id)
  else currentGroups.add(id)
  return { ...current, [diffKey]: [...currentGroups] }
}

export function WorkspaceInlineDiffPreview({ diff, loading, error }: WorkspaceInlineDiffPreviewProps) {
  const [expandedGroupsByDiff, setExpandedGroupsByDiff] = useState<Record<string, string[]>>({})
  const diffKey = diff ? `${diff.path}\u0000${diff.oldContent.length}\u0000${diff.newContent.length}` : ''
  const expandedGroups = useMemo(() => new Set(expandedGroupsByDiff[diffKey] ?? []), [diffKey, expandedGroupsByDiff])
  const rows = useMemo(() => {
    if (!diff) return undefined
    const diffRows = buildDiffLines(diff.oldContent, diff.newContent)
    return diffRows ? collapseUnmodifiedRows(diffRows) : undefined
  }, [diff])

  if (loading) {
    return <div className="border-t border-[color-mix(in_oklab,var(--border)_34%,transparent)] bg-background px-3 py-4 text-sm text-muted-foreground/70">{t('workspaceLoadingDiff')}</div>
  }

  if (error) {
    return <div className="border-t border-[color-mix(in_oklab,var(--border)_34%,transparent)] bg-background px-3 py-4 text-sm text-destructive">{error}</div>
  }

  if (!diff) {
    return <div className="border-t border-[color-mix(in_oklab,var(--border)_34%,transparent)] bg-background px-3 py-4 text-sm text-muted-foreground/70">{t('workspaceNoDiffPreview')}</div>
  }

  if (!rows) {
    return <div className="border-t border-[color-mix(in_oklab,var(--border)_34%,transparent)] bg-background px-3 py-4 text-sm text-muted-foreground/70">{t('workspaceDiffTooLarge')}</div>
  }

  if (rows.length === 0) {
    return <div className="border-t border-[color-mix(in_oklab,var(--border)_34%,transparent)] bg-background px-3 py-4 text-sm text-muted-foreground/70">{t('workspaceNoDiffPreview')}</div>
  }

  return (
    <div className="rounded-b-xl border-t border-[color-mix(in_oklab,var(--border)_34%,transparent)] bg-background">
      <div className="max-h-[28rem] overflow-auto pb-1">
        <div className="min-w-max py-2">
          {rows.map((row) => {
            if (row.kind !== 'collapsed') return <DiffContentLine key={`${row.kind}:${row.oldLine ?? ''}:${row.newLine ?? ''}:${row.text}`} row={row} />
            const expanded = expandedGroups.has(row.id)
            return (
              <div key={row.id}>
                <div className="grid min-w-max grid-cols-[3rem_minmax(34rem,1fr)] gap-1 py-1 pr-4">
                  <button
                    type="button"
                    className="flex h-12 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground/75 transition-colors hover:bg-muted/78 hover:text-foreground/80"
                    onClick={() => {
                      setExpandedGroupsByDiff((current) => toggleExpandedGroup(current, diffKey, row.id))
                    }}
                    aria-expanded={expanded}
                    title={t('workspaceUnmodifiedLines', { count: row.count })}
                  >
                    <ChevronDown className={cn('size-4 transition-transform', expanded && 'rotate-180')} />
                  </button>
                  <button
                    type="button"
                    className="flex h-12 items-center rounded-lg bg-muted/60 px-4 text-left text-base font-medium text-muted-foreground/80 transition-colors hover:bg-muted/78 hover:text-foreground/80"
                    onClick={() => {
                      setExpandedGroupsByDiff((current) => toggleExpandedGroup(current, diffKey, row.id))
                    }}
                    aria-expanded={expanded}
                  >
                    {t('workspaceUnmodifiedLines', { count: row.count })}
                  </button>
                </div>
                {expanded ? row.rows.map((hiddenRow) => <DiffContentLine key={`hidden:${row.id}:${hiddenRow.oldLine}:${hiddenRow.newLine}`} row={hiddenRow} />) : null}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
