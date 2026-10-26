import { Maximize, Minimize, PanelRight, Plus, SquareTerminal } from 'lucide-react'
import type { Dispatch, SetStateAction, RefObject } from 'react'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { viewFromPanelKind } from './useInspectorTabs'
import type { WorkspacePanelTab, WorkspacePanelPrimaryTabKind } from './workspace-inspector-tabs'
import type { WorkspacePanelTabMeta } from './workspace-panel-tabs'
import { WorkspaceTabStrip } from './WorkspaceTabStrip'

type WorkspaceInspectorHeaderProps = {
  panelTabs: WorkspacePanelTab[]
  activePanelTab?: WorkspacePanelTab
  projectName?: string
  tabListOpen: boolean
  setTabListOpen: Dispatch<SetStateAction<boolean>>
  tabListRef: RefObject<HTMLDivElement | null>
  menuRef: RefObject<HTMLDivElement | null>
  menuOpen: boolean
  setMenuOpen: Dispatch<SetStateAction<boolean>>
  draggingPanelTabId?: string
  activatePanelTab: (tab: WorkspacePanelTab) => void
  closePanelTab: (id: string) => void
  closeOtherPanelTabs: () => void
  closeAllPanelTabs: () => void
  handlePanelTabDragStart: (event: DragStartEvent) => void
  finishPanelTabDrag: () => void
  handlePanelTabDragEnd: (event: DragEndEvent) => void
  openPanelTab: (kind: WorkspacePanelPrimaryTabKind, nextView?: ReturnType<typeof viewFromPanelKind>) => void
  availablePanelTabItems: WorkspacePanelTabMeta[]
  fullscreen: boolean
  fullscreenAnimating: boolean
  globalTerminalOpen: boolean
  onShowGlobalTerminal?: () => void
  onOpenChange: (open: boolean) => void
  toggleFullscreen: (afterExit?: () => void) => void
}

export function WorkspaceInspectorHeader({ panelTabs, activePanelTab, projectName, tabListOpen, setTabListOpen, tabListRef, menuRef, menuOpen, setMenuOpen, draggingPanelTabId, activatePanelTab, closePanelTab, closeOtherPanelTabs, closeAllPanelTabs, handlePanelTabDragStart, finishPanelTabDrag, handlePanelTabDragEnd, openPanelTab, availablePanelTabItems, fullscreen, fullscreenAnimating, globalTerminalOpen, onShowGlobalTerminal, onOpenChange, toggleFullscreen }: WorkspaceInspectorHeaderProps) {
  return (
    <div className={cn(
      'flex h-14 shrink-0 items-center gap-2 border-b border-[color-mix(in_oklab,var(--border)_34%,transparent)] bg-background pl-3 transition-opacity duration-150',
      fullscreen ? 'pr-2' : 'pr-[5.5rem]',
      fullscreenAnimating ? 'opacity-0' : 'opacity-100',
    )}>
      <WorkspaceTabStrip
        panelTabs={panelTabs}
        activePanelTabId={activePanelTab?.id}
        projectName={projectName}
        tabListOpen={tabListOpen}
        setTabListOpen={setTabListOpen}
        tabListRef={tabListRef}
        draggingPanelTabId={draggingPanelTabId}
        activatePanelTab={activatePanelTab}
        closePanelTab={closePanelTab}
        closeOtherPanelTabs={closeOtherPanelTabs}
        closeAllPanelTabs={closeAllPanelTabs}
        handlePanelTabDragStart={handlePanelTabDragStart}
        finishPanelTabDrag={finishPanelTabDrag}
        handlePanelTabDragEnd={handlePanelTabDragEnd}
      />
      <div className="flex shrink-0 items-center gap-1">
        {panelTabs.length > 0 || fullscreen ? (
          <div ref={menuRef} className="relative shrink-0">
            <Button
              variant="ghost"
              size="icon"
              type="button"
              className="rounded-[10px] hover:bg-[var(--quickforge-sidebar-hover-bg)] disabled:opacity-40"
              onClick={() => setMenuOpen((value) => !value)}
              aria-label={t('rightPanelAddTab')}
              title={t('rightPanelAddTab')}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <Plus className="size-[18px] stroke-[1.85]" />
            </Button>
            {menuOpen ? (
            <div className="absolute right-0 top-12 z-40 w-64 rounded-2xl border border-[color-mix(in_oklab,var(--border)_34%,transparent)] bg-popover p-2 shadow-quickforge" role="menu">
              {availablePanelTabItems.map((item) => {
                const Icon = item.icon
                const active = item.kind === activePanelTab?.kind
                return (
                  <button
                    key={item.kind}
                    type="button"
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] font-medium transition-colors',
                      active ? 'text-foreground' : 'hover:text-foreground',
                    )}
                    onClick={() => openPanelTab(item.kind, viewFromPanelKind(item.kind))}
                    role="menuitem"
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  </button>
                )
              })}
            </div>
          ) : null}
          </div>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 rounded-[10px] hover:bg-[var(--quickforge-sidebar-hover-bg)] disabled:opacity-40"
          disabled={fullscreenAnimating}
          onClick={() => toggleFullscreen()}
          aria-label={fullscreen ? t('workspaceExitFullscreen') : t('workspaceFullscreen')}
          title={fullscreen ? t('workspaceExitFullscreen') : t('workspaceFullscreen')}
        >
          {fullscreen ? <Minimize className="size-[18px] stroke-[1.85]" /> : <Maximize className="size-[18px] stroke-[1.85]" />}
        </Button>
        {fullscreen ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'shrink-0 rounded-[10px] hover:bg-[var(--quickforge-sidebar-hover-bg)] disabled:opacity-40',
                globalTerminalOpen && 'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground',
              )}
              disabled={fullscreenAnimating || !onShowGlobalTerminal}
              onClick={() => toggleFullscreen(onShowGlobalTerminal)}
              aria-label={t('rightPanelTerminal')}
              title={t('rightPanelTerminal')}
            >
              <SquareTerminal className="size-[18px] stroke-[1.85]" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 rounded-[10px] bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-40"
              disabled={fullscreenAnimating}
              onClick={() => toggleFullscreen(() => onOpenChange(false))}
              aria-label={t('workspaceCollapseRightPanel')}
              title={t('workspaceCollapseRightPanel')}
            >
              <PanelRight className="size-[18px] stroke-[1.85]" />
            </Button>
          </>
        ) : null}
      </div>
    </div>
  )
}
