// 侧栏共享类名常量。静态字符串集中在此；随 sidebarOpen 变化的行级类名用工厂函数生成，
// 保证 ChatSidebar 与各子模块拼出的类名完全一致。不要在组件里内联复制这些字符串。

export const sidebarHoverBgClass = 'hover:bg-[var(--quickforge-sidebar-hover-bg)]'
export const sidebarActiveBgClass = 'bg-[var(--quickforge-sidebar-hover-bg)]'

export const sidebarSessionRowBaseClass = 'group relative flex items-center gap-2 overflow-hidden rounded-lg py-1.5 text-left transition-[background-color,color,box-shadow] duration-160 ease-out'
export const sidebarSessionTitleClass = 'quickforge-sidebar-label-in truncate text-sm font-[350] leading-5'

export const sectionHeaderClass = `quickforge-sidebar-label-in quickforge-sidebar-section-header group mb-1 flex w-full items-center gap-1 rounded-lg px-2 py-1 text-sm font-[350] leading-5 text-muted-foreground/50 transition-colors ${sidebarHoverBgClass}`
export const sectionToggleClass = 'quickforge-sidebar-section-toggle flex min-w-0 flex-1 items-center gap-1 text-left transition-colors'
export const draggableSectionTitleClass = `${sectionToggleClass} cursor-grab touch-none active:cursor-grabbing`
export const chevronClass = 'quickforge-sidebar-section-icon size-4 shrink-0 text-current opacity-0 transition-[transform,opacity] duration-200 ease-out group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none'
export const collapsePanelClass = 'grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none'
export const collapsePanelOpenClass = 'grid-rows-[1fr] opacity-100'
export const collapsePanelClosedClass = 'pointer-events-none grid-rows-[0fr] opacity-0'
export const collapseInnerClass = 'min-h-0 overflow-hidden'

export const activeRowClass = `${sidebarActiveBgClass} shadow-[0_8px_22px_-20px_rgb(15_23_42_/_0.32)]`
export const projectActiveRowClass = sidebarHoverBgClass
export const inactiveRowClass = `${sidebarHoverBgClass} `
export const sessionInactiveRowClass = `${sidebarHoverBgClass} `

export const iconSlotClass = 'inline-flex size-6 shrink-0 items-center justify-center rounded-full transition-colors'
export const iconButtonClass = `size-7 shrink-0 rounded-full transition-[background-color,color,box-shadow,opacity] duration-160 ease-out ${sidebarHoverBgClass}`
export const sectionActionButtonClass = `quickforge-sidebar-section-icon ${iconButtonClass} pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100`

export const actionOverlayBaseClass = 'pointer-events-none absolute inset-y-0 right-2 z-20 flex items-center rounded-r-lg bg-gradient-to-l from-[var(--quickforge-sidebar-hover-bg)] via-[var(--quickforge-sidebar-hover-bg)]/95 to-transparent pl-4 opacity-0 transition-opacity duration-160'
export const actionOverlayClass = `${actionOverlayBaseClass} gap-1 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100`
export const projectActionOverlayClass = `${actionOverlayBaseClass} gap-px group-hover:pointer-events-auto group-hover:opacity-100`
export const overlayIconButtonClass = `size-6 shrink-0 rounded-full transition-[background-color,color,box-shadow] duration-160 ease-out ${sidebarHoverBgClass}`
export const overlayArchiveButtonClass = `size-6 shrink-0 rounded-full transition-[background-color,color,box-shadow] duration-160 ease-out ${sidebarHoverBgClass}`

export const sessionButtonClass = 'flex min-w-0 flex-1 items-center gap-1 text-left'
export const sessionTitleRowClass = 'flex min-w-0 flex-1 items-center gap-1 truncate'
export const sessionMetaHoverHiddenClass = 'group-hover:pointer-events-none group-hover:opacity-0 group-focus-within:pointer-events-none group-focus-within:opacity-0'
export const activeSessionTitleClass = 'font-[350]'
export const activeProjectTitleClass = 'font-[350]'
export const timeClass = 'quickforge-sidebar-session-time w-11 shrink-0 whitespace-nowrap text-right text-[11px] leading-4 transition-opacity duration-160'

export const searchDialogClass = 'fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh] backdrop-blur-sm'
export const projectMenuClass = 'fixed z-50 min-w-48 overflow-hidden rounded-lg border border-border bg-background p-1 shadow-quickforge'
export const viewSortMenuClass = 'fixed z-50 overflow-hidden rounded-2xl border border-border bg-background p-1.5 shadow-quickforge'
export const viewSortMenuSectionLabelClass = 'px-3 pb-1 pt-2 text-xs font-[350] leading-4 text-muted-foreground/50'
export const viewSortMenuItemClass = 'flex w-full items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2.5 text-left text-sm transition-colors'
export const sessionHoverTipClass = 'pointer-events-none fixed z-50 w-[min(24rem,calc(100vw-1rem))] max-w-sm rounded-2xl border border-border bg-popover px-4 py-3 text-left shadow-quickforge'
export const sessionHoverTipMetaClass = 'mt-2 flex items-center gap-2 text-sm leading-5'

/** 会话行基类：随 sidebarOpen 切换「展开有内边距 / 收起居中」两种形态。 */
export function sidebarRowClass(sidebarOpen: boolean) {
  return `${sidebarSessionRowBaseClass} ${sidebarOpen ? 'px-2' : 'justify-center px-0'}`
}

/** 底部行基类：与会话行同款的开合形态，但不带 hover 行为。 */
export function sidebarFooterRowClass(sidebarOpen: boolean) {
  return `group relative flex items-center gap-2 overflow-hidden py-1.5 text-left transition-[background-color,color,box-shadow] duration-160 ease-out ${sidebarOpen ? 'px-2' : 'justify-center px-0'}`
}
