import { t } from '@/lib/i18n'
import type { MigrationStatus } from '@/lib/migration-status'
import { migrationPhaseStage } from '@/lib/migration-status'
import { StartupSplashIcon } from '@/components/startup-splash-icon'

const MIGRATION_DOMAINS = [
  { key: 'scheduledRuns', label: 'migration.domain.scheduledRuns' },
  { key: 'sessionState', label: 'migration.domain.sessionState' },
  { key: 'share', label: 'migration.domain.share' },
  { key: 'lanAccess', label: 'migration.domain.lanAccess' },
] as const

// Dot styles follow the design language's "normal → active → done" intensity
// ladder: faint for pending, pulsing for the active cutover, solid when done.
// No new colors are introduced.
const PHASE_DOT_CLASSES = {
  pending: 'bg-border',
  running: 'quickforge-migration-dot-active bg-foreground',
  finalizing: 'quickforge-migration-dot-active bg-foreground',
  done: 'bg-foreground',
  unknown: 'border border-muted-foreground/40',
} as const

type MigrationStage = keyof typeof PHASE_DOT_CLASSES

// Rendered instead of StartupSplash while the server is inside the startup
// maintenance window (storage migrating to SQLite in the background). Reuses
// the splash layout, background blur and icon animation.
export function MigrationProgressView({ status }: { status: MigrationStatus }) {
  const title = t('migration.title')

  return (
    <div className="quickforge-startup-splash" role="status" aria-label={title}>
      <div className="flex w-72 flex-col items-center gap-5 text-center">
        <StartupSplashIcon />
        <div className="flex flex-col gap-1.5">
          <h1 className="text-sm font-medium text-foreground">{title}</h1>
          <p className="text-xs leading-relaxed text-muted-foreground">{t('migration.description')}</p>
        </div>
        <ul className="flex w-full flex-col gap-2">
          {MIGRATION_DOMAINS.map((domain) => {
            const stage: MigrationStage = migrationPhaseStage(status.domains[domain.key]?.phase ?? 'unknown')
            return (
              <li key={domain.key} className="flex items-center gap-2.5 text-xs">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${PHASE_DOT_CLASSES[stage]}`} aria-hidden="true" />
                <span className="flex-1 text-left text-foreground/90">{t(domain.label)}</span>
                <span className="text-muted-foreground">{t(`migration.phase.${stage}`)}</span>
              </li>
            )
          })}
        </ul>
        <p className="text-xs text-muted-foreground">{t('migration.polling')}</p>
      </div>
    </div>
  )
}
