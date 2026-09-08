import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const sidebarSource = readFileSync(new URL('../../src/components/sidebar/ChatSidebar.tsx', import.meta.url), 'utf8')

function countOccurrences(haystack: string, needle: string) {
  return haystack.split(needle).length - 1
}

// 会话行右侧几何：
// 静置态（行内流）[标题 flex-1][时间槽 w-11] 贴右 + 行右 padding px-2(8px)——
// 置顶会话只出现在置顶分区，其余列表已按 pinned=exclude 过滤，静置不渲染 pin 槽；
// hover 态（absolute right-2=8px）[Pin/PinOff size-6=24px][gap-1=4px][Archive size-6=24px] + pl-4 渐变。
// 浮层按钮组紧凑贴尾（两按钮同 24px 槽，图标间距 14px）；静置时间槽右缘与 Archive 右缘同锚 8px。
describe('sidebar session action alignment', () => {
  it('resting rows render no pin affordance: pinned sessions live only in the pinned section', () => {
    expect(sidebarSource).not.toContain('pinnedSessionButtonClass')
    expect(countOccurrences(sidebarSource, '<span className="size-6 shrink-0" aria-hidden="true" />')).toBe(0)
  })

  it('hover pin keeps the size-6 slot and fades opacity smoothly', () => {
    const overlayIconButtonLine = sidebarSource.match(/const overlayIconButtonClass = `([^`]+)`/)?.[1] ?? ''
    expect(overlayIconButtonLine).toContain('size-6')
    expect(overlayIconButtonLine).toContain('shrink-0')
    // twMerge 会丢弃与前一个冲突的 transition 工具类；同时出现两个 transition-* 会让 opacity 瞬变
    expect(overlayIconButtonLine).not.toContain('transition-opacity')
    expect(overlayIconButtonLine).not.toContain('transition-colors')
  })

  it('session time occupies a fixed right-aligned w-11 slot', () => {
    const timeClassLine = sidebarSource.match(/const timeClass = '([^']+)'/)?.[1] ?? ''
    expect(timeClassLine).toContain('w-11')
    expect(timeClassLine).toContain('text-right')
  })

  it('overlay mirrors the resting cluster: right-2 anchor, session gap-2, project gap-px, compact size-6 archive button', () => {
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
    // 浮层按钮组紧凑贴尾：Archive 与 Pin 同为 size-6(24px) 圆形按钮，图标间距 14px；
    // 静置 pin 已随置顶分区独占展示移除，无需 44px 胶囊对齐时间槽
    expect(archiveClassLine).toContain('size-6')
    expect(archiveClassLine).not.toContain('w-11')
    expect(archiveClassLine).not.toContain('w-9')
    expect(countOccurrences(sidebarSource, 'className={overlayArchiveButtonClass}')).toBe(4)
  })

  it('running/unread status replaces time inside the fixed w-11 slot so hover geometry stays stable', () => {
    // 旧模式必须移除：状态指示器单独占位、running/未读时省略时间槽，
    // 都会让时间槽宽度漂移、破坏 Archive 胶囊对齐
    expect(sidebarSource).not.toContain('sessionStatusIndicator')
    expect(sidebarSource).not.toContain('completedSessionIds.has(session.id) ? null : (')
    // 置顶区/项目行/全局行三处共用 sessionTimeSlotContent，时间槽恒定渲染（宽度恒 w-11）
    expect(countOccurrences(sidebarSource, 'sessionTimeSlotContent(session, formatSessionTime')).toBe(3)
    const slotFn = sidebarSource.match(/const sessionTimeSlotContent = \([^)]+\) => \{([\s\S]*?)\n {2}\}/)?.[1] ?? ''
    expect(slotFn).toContain('Loader2')
    expect(slotFn).toContain('animate-spin')
    expect(slotFn).toContain('bg-emerald-500')
    // 槽为 text-right 的行内上下文（非 flex），dot 必须显式 inline-block 才能生效宽高
    expect(slotFn).toContain('inline-block')
  })

  it('pin icons are one size everywhere (size-3.5): list overlays pin, the pinned section unpins', () => {
    expect(countOccurrences(sidebarSource, '<Pin className="size-3.5" />')).toBe(3)
    expect(countOccurrences(sidebarSource, '<PinOff className="size-3.5" />')).toBe(1)
    expect(countOccurrences(sidebarSource, '<Pin className="size-3" />')).toBe(0)
  })

  it('pinned-section overlay unpins (PinOff + unpinSession); list overlays pin (pinSession)', () => {
    expect(countOccurrences(sidebarSource, "aria-label={t('unpinSession')}")).toBe(1)
    expect(countOccurrences(sidebarSource, "aria-label={t('pinSession')}")).toBe(3)
  })

  it('archive icons in session overlays are unified at size-3.5', () => {
    expect(countOccurrences(sidebarSource, '<Archive className="size-3.5" />')).toBe(4)
    expect(countOccurrences(sidebarSource, '<Archive className="size-4" />')).toBe(0)
  })

  it('keeps resting rows time-only and overlay order [pin|pinOff][archive] in every session row', () => {
    const rowPatterns = [
      /formatSessionTime\(session\.pinnedAt\)/,
      /formatSessionTime\(timeValue\)/,
      /formatSessionTime\(sessionSortMode === 'createdAt' \? session\.createdAt : session\.lastModified\)/,
    ]
    for (const pattern of rowPatterns) {
      const matches = [...sidebarSource.matchAll(new RegExp(pattern.source, 'g'))]
      expect(matches.length).toBeGreaterThan(0)
      for (const match of matches) {
        // 静置态时间槽是行内最右元素：标题与时间槽之间不得再插入 pin 槽
        const titleIndex = sidebarSource.lastIndexOf('SessionTitleMarquee', match.index ?? 0)
        const restingSource = sidebarSource.slice(titleIndex, match.index ?? 0)
        expect(restingSource).not.toContain('<Pin')
        const overlayStart = sidebarSource.indexOf('actionOverlayClass', match.index ?? 0)
        const overlayEnd = sidebarSource.indexOf('</div>', overlayStart)
        const overlaySource = sidebarSource.slice(overlayStart, overlayEnd)
        expect(overlaySource.indexOf('toggleSessionPinFromActions')).toBeLessThan(overlaySource.indexOf('requestDeleteSession'))
      }
    }
  })
})
