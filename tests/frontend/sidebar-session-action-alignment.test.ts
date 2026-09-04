import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const sidebarSource = readFileSync(new URL('../../src/components/sidebar/ChatSidebar.tsx', import.meta.url), 'utf8')

function countOccurrences(haystack: string, needle: string) {
  return haystack.split(needle).length - 1
}

// 会话行右侧采用镜像槽位几何：
// 静置态（行内流）[标题 flex-1][pin 槽 size-6][gap-1][时间槽 w-9] + 行右 padding px-2(8px)
// hover 态（absolute right-2=8px）[Pin size-6][gap-1][Archive h-6 w-9] + pl-4 渐变
// 两个 pin 槽中心重合，Archive 胶囊精确覆盖时间槽，
// 置顶图标 hover 交叉淡入淡出时零位移、零缩放；行内与浮层间距必须一致（均为 gap-1）。
describe('sidebar session action alignment', () => {
  it('resting pin button matches overlay pin geometry (size-6) and fades opacity smoothly', () => {
    const pinnedClassLine = sidebarSource.match(/const pinnedSessionButtonClass = `([^`]+)`/)?.[1] ?? ''
    expect(pinnedClassLine).toContain('size-6')
    expect(pinnedClassLine).toContain('transition-[color,opacity]')
    // twMerge 会丢弃与前一个冲突的 transition 工具类；同时出现两个 transition-* 会让 opacity 瞬变
    expect(pinnedClassLine).not.toContain('transition-opacity')
    expect(pinnedClassLine).not.toContain('transition-colors')
  })

  it('session time occupies a fixed right-aligned w-9 slot', () => {
    const timeClassLine = sidebarSource.match(/const timeClass = '([^']+)'/)?.[1] ?? ''
    expect(timeClassLine).toContain('w-9')
    expect(timeClassLine).toContain('text-right')
  })

  it('unpinned rows reserve the same size-6 pin slot so time and title columns stay aligned', () => {
    expect(countOccurrences(sidebarSource, '<span className="size-6 shrink-0" aria-hidden="true" />')).toBe(3)
  })

  it('overlay mirrors the resting cluster: right-2 anchor, session gap-2, project gap-px, w-9 archive pill', () => {
    const overlayBaseLine = sidebarSource.match(/const actionOverlayBaseClass = '([^']+)'/)?.[1] ?? ''
    expect(overlayBaseLine).toContain('right-2')
    expect(overlayBaseLine).not.toContain('right-1')
    expect(overlayBaseLine).not.toContain('gap-px')

    const overlayClassLine = sidebarSource.match(/const actionOverlayClass = `\$\{actionOverlayBaseClass\} ([^`]+)`/)?.[1] ?? ''
    expect(overlayClassLine).toContain('gap-1')

    const sessionButtonClassLine = sidebarSource.match(/const sessionButtonClass = '([^']+)'/)?.[1] ?? ''
    expect(sessionButtonClassLine).toContain('gap-1')
    // Pinned 分区与时间线行使用同一份内联主按钮类，间距须与浮层一致
    expect(countOccurrences(sidebarSource, 'className="flex min-w-0 flex-1 items-center gap-1 text-left"')).toBe(2)
    expect(countOccurrences(sidebarSource, 'className="flex min-w-0 flex-1 items-center gap-2 text-left"')).toBe(0)

    const projectOverlayClassLine = sidebarSource.match(/const projectActionOverlayClass = `\$\{actionOverlayBaseClass\} ([^`]+)`/)?.[1] ?? ''
    expect(projectOverlayClassLine).toContain('gap-px')

    const archiveClassLine = sidebarSource.match(/const overlayArchiveButtonClass = `([^`]+)`/)?.[1] ?? ''
    expect(archiveClassLine).toContain('h-6')
    expect(archiveClassLine).toContain('w-9')
    expect(countOccurrences(sidebarSource, 'className={overlayArchiveButtonClass}')).toBe(4)
  })

  it('pin icons are one size everywhere (size-3.5) across resting and hover states', () => {
    expect(countOccurrences(sidebarSource, '<Pin className="size-3.5" />')).toBe(8)
    expect(countOccurrences(sidebarSource, '<Pin className="size-3" />')).toBe(0)
  })

  it('archive icons in session overlays are unified at size-3.5', () => {
    expect(countOccurrences(sidebarSource, '<Archive className="size-3.5" />')).toBe(4)
    expect(countOccurrences(sidebarSource, '<Archive className="size-4" />')).toBe(0)
  })

  it('keeps resting order [pin][time] and overlay order [pin][archive] in every session row', () => {
    const rowPatterns = [
      /formatSessionTime\(session\.pinnedAt\)/,
      /formatSessionTime\(timeValue\)/,
      /formatSessionTime\(sessionSortMode === 'createdAt' \? session\.createdAt : session\.lastModified\)/,
    ]
    for (const pattern of rowPatterns) {
      const matches = [...sidebarSource.matchAll(new RegExp(pattern.source, 'g'))]
      expect(matches.length).toBeGreaterThan(0)
      for (const match of matches) {
        const rowStart = sidebarSource.lastIndexOf('<button', match.index ?? 0)
        const rowEnd = match.index ?? 0
        const rowSource = sidebarSource.slice(rowStart, rowEnd)
        expect(rowSource.indexOf('pinnedSessionButtonClass')).toBeGreaterThanOrEqual(0)
        const overlayStart = sidebarSource.indexOf('actionOverlayClass', rowEnd)
        const overlayEnd = sidebarSource.indexOf('</div>', overlayStart)
        const overlaySource = sidebarSource.slice(overlayStart, overlayEnd)
        expect(overlaySource.indexOf('toggleSessionPinFromActions')).toBeLessThan(overlaySource.indexOf('requestDeleteSession'))
      }
    }
  })
})
