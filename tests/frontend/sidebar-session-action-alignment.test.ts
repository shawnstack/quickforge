import { describe, expect, it } from 'vitest'
import { sidebarModule } from './helpers/sidebar-module'

const sidebarSource = sidebarModule.chatSidebar
const classesSource = sidebarModule.classes
const rowSource = sidebarModule.sessionRow

function countOccurrences(haystack: string, needle: string) {
  return haystack.split(needle).length - 1
}

// 会话行右侧几何（类名集中在 sidebar-classes.ts，行渲染集中在 SidebarSessionRow.tsx）：
// 静置态（行内流）[标题 flex-1][时间槽 w-11] 贴右 + 行右 padding px-2(8px)——
// 置顶会话只出现在置顶分区，其余列表已按 pinned=exclude 过滤，静置不渲染 pin 槽；
// hover 态（absolute right-2=8px）[Pin/PinOff size-6=24px][gap-1=4px][Archive size-6=24px] + pl-4 渐变。
// 浮层按钮组紧凑贴尾（两按钮同 24px 槽，图标间距 14px）；静置时间槽右缘与 Archive 右缘同锚 8px。
describe('sidebar session action alignment', () => {
  it('resting rows render no pin affordance: pinned sessions live only in the pinned section', () => {
    expect(sidebarSource).not.toContain('pinnedSessionButtonClass')
    expect(countOccurrences(rowSource, '<span className="size-6 shrink-0" aria-hidden="true" />')).toBe(0)
  })

  it('hover pin keeps the size-6 slot and fades opacity smoothly', () => {
    const overlayIconButtonLine = classesSource.match(/export const overlayIconButtonClass = `([^`]+)`/)?.[1] ?? ''
    expect(overlayIconButtonLine).toContain('size-6')
    expect(overlayIconButtonLine).toContain('shrink-0')
    // twMerge 会丢弃与前一个冲突的 transition 工具类；同时出现两个 transition-* 会让 opacity 瞬变
    expect(overlayIconButtonLine).not.toContain('transition-opacity')
    expect(overlayIconButtonLine).not.toContain('transition-colors')
  })

  it('session time occupies a fixed right-aligned w-11 slot', () => {
    const timeClassLine = classesSource.match(/export const timeClass = '([^']+)'/)?.[1] ?? ''
    expect(timeClassLine).toContain('w-11')
    expect(timeClassLine).toContain('text-right')
  })

  it('overlay mirrors the resting cluster: right-2 anchor, session gap-2, project gap-px, compact size-6 archive button', () => {
    const overlayBaseLine = classesSource.match(/export const actionOverlayBaseClass = '([^']+)'/)?.[1] ?? ''
    expect(overlayBaseLine).toContain('right-2')
    expect(overlayBaseLine).not.toContain('right-1')
    expect(overlayBaseLine).not.toContain('gap-px')

    const overlayClassLine = classesSource.match(/export const actionOverlayClass = `\$\{actionOverlayBaseClass\} ([^`]+)`/)?.[1] ?? ''
    expect(overlayClassLine).toContain('gap-1')

    const sessionButtonClassLine = classesSource.match(/export const sessionButtonClass = '([^']+)'/)?.[1] ?? ''
    expect(sessionButtonClassLine).toContain('gap-1')
    // 置顶分区的 div[role=button] 与其余列表的 sessionButtonClass 同串，间距须与浮层一致
    expect(countOccurrences(rowSource, 'className="flex min-w-0 flex-1 items-center gap-1 text-left"')).toBe(1)
    expect(countOccurrences(rowSource, 'className="flex min-w-0 flex-1 items-center gap-2 text-left"')).toBe(0)

    const projectOverlayClassLine = classesSource.match(/export const projectActionOverlayClass = `\$\{actionOverlayBaseClass\} ([^`]+)`/)?.[1] ?? ''
    expect(projectOverlayClassLine).toContain('gap-px')

    const archiveClassLine = classesSource.match(/export const overlayArchiveButtonClass = `([^`]+)`/)?.[1] ?? ''
    // 浮层按钮组紧凑贴尾：Archive 与 Pin 同为 size-6(24px) 圆形按钮，图标间距 14px；
    // 静置 pin 已随置顶分区独占展示移除，无需 44px 胶囊对齐时间槽
    expect(archiveClassLine).toContain('size-6')
    expect(archiveClassLine).not.toContain('w-11')
    expect(archiveClassLine).not.toContain('w-9')
    expect(countOccurrences(rowSource, 'className={overlayArchiveButtonClass}')).toBe(1)
  })

  it('running/unread status replaces time inside the fixed w-11 slot so hover geometry stays stable', () => {
    // 旧模式必须移除：状态指示器单独占位、running/未读时省略时间槽，
    // 都会让时间槽宽度漂移、破坏 Archive 胶囊对齐
    expect(rowSource).not.toContain('sessionStatusIndicator')
    expect(rowSource).not.toContain('completedSessionIds.has(session.id) ? null : (')
    // 时间线行直接展示时间文本，其余三个变体共用 sessionTimeSlotContent，时间槽恒定渲染（宽度恒 w-11）
    expect(rowSource).toContain("variant === 'timeline'")
    expect(rowSource).toContain('sessionTimeSlotContent(session, timeText, sessionTaskStatus, completedSessionIds)')
    const slotFn = rowSource.match(/function sessionTimeSlotContent\(([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(slotFn).toContain('Loader2')
    expect(slotFn).toContain('animate-spin')
    expect(slotFn).toContain('bg-emerald-500')
    // 槽为 text-right 的行内上下文（非 flex）：spinner 必须 inline-block 才会贴尾，dot 也需它才能生效宽高
    const loaderClass = slotFn.match(/<Loader2 className="([^"]+)"/)?.[1] ?? ''
    expect(loaderClass).toContain('inline-block')
    const unreadClass = slotFn.match(/<span className="([^"]+)" aria-label="未读"/)?.[1] ?? ''
    expect(unreadClass).toContain('inline-block')
  })

  it('pin icons are one size everywhere (size-3.5): list overlays pin, the pinned section unpins', () => {
    expect(countOccurrences(rowSource, '<Pin className="size-3.5" />')).toBe(1)
    expect(countOccurrences(rowSource, '<PinOff className="size-3.5" />')).toBe(1)
    expect(countOccurrences(rowSource, '<Pin className="size-3" />')).toBe(0)
  })

  it('pinned-section overlay unpins (PinOff + unpinSession); list overlays pin (pinSession)', () => {
    expect(countOccurrences(rowSource, "variant === 'pinned' ? t('unpinSession') : t('pinSession')")).toBe(1)
  })

  it('archive icons in session overlays are unified at size-3.5', () => {
    expect(countOccurrences(rowSource, '<Archive className="size-3.5" />')).toBe(1)
    expect(countOccurrences(rowSource, '<Archive className="size-4" />')).toBe(0)
  })

  it('keeps resting rows time-only and overlay order [pin|pinOff][archive] in every session row', () => {
    // 装配层三个时间口径（置顶 pinnedAt / 时间线·项目·全局的排序键）都只喂 timeText
    expect(countOccurrences(sidebarSource, 'formatSessionTime(session.pinnedAt)')).toBe(1)
    expect(countOccurrences(sidebarSource, "formatSessionTime(sessionSortMode === 'createdAt' ? session.createdAt : session.lastModified)")).toBe(3)

    // 行内静置结构：marquee 与时间槽之间不得再插入 pin 槽
    const marqueeIndex = rowSource.indexOf('<SessionTitleMarquee')
    const timeIndex = rowSource.indexOf('!actionsSuppressed && sessionMetaHoverHiddenClass')
    expect(marqueeIndex).toBeGreaterThan(-1)
    expect(timeIndex).toBeGreaterThan(marqueeIndex)
    const restingSource = rowSource.slice(marqueeIndex, timeIndex)
    expect(restingSource).not.toContain('<Pin')

    // 浮层内 pin 动作在 archive 之前
    const overlayStart = rowSource.indexOf('className={cn(actionOverlayClass')
    const overlayEnd = rowSource.indexOf('</div>', overlayStart)
    const overlaySource = rowSource.slice(overlayStart, overlayEnd)
    expect(overlaySource.indexOf('onTogglePin')).toBeLessThan(overlaySource.indexOf('onRequestDelete'))
  })
})
