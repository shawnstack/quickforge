import { t } from '@/lib/i18n'
import type { WorkspacePanelPrimaryTabKind } from './workspace-inspector-tabs'
import type { WorkspacePanelTabMeta } from './workspace-panel-tabs'

type WorkspacePanelLandingProps = {
  items: WorkspacePanelTabMeta[]
  onOpenPanelTab: (kind: WorkspacePanelPrimaryTabKind) => void
}

/** 未打开任何 Tab 时的入口列表：与「+」菜单共用可用的面板项。 */
export function WorkspacePanelLanding({ items, onOpenPanelTab }: WorkspacePanelLandingProps) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-5">
      <div className="w-full max-w-[26rem] space-y-4">
        <div className="text-center font-sans">
          <div className="text-lg font-semibold leading-tight tracking-[-0.01em]">{t('rightPanelOpenTabsTitle')}</div>
          <div className="mt-2 text-sm leading-5">{t('rightPanelOpenTabsDescription')}</div>
        </div>
        <div className="space-y-2">
          {items.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.kind}
                type="button"
                className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-[color-mix(in_oklab,var(--border)_34%,transparent)] bg-muted/60 px-4 py-3 text-left transition-colors"
                onClick={() => onOpenPanelTab(item.kind)}
              >
                <Icon className="size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{item.label}</div>
                  <div className="mt-0.5 text-xs leading-4">{item.description}</div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
