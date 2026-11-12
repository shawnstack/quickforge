import { t } from '@/lib/i18n'
import type { SkillSummary, SkillsScope } from '@/lib/types'

/**
 * Skill 来源域的纯展示映射：source 字段 → 分组、分组标签/提示、搜索路径标签。
 * 列表、工具栏、页头与详情弹窗共用，避免各视图自算一套。
 */

export type SourceGroup = 'builtin' | 'personal' | 'plugin'
export type SourceFilter = 'all' | SourceGroup

export const SOURCE_GROUPS: SourceGroup[] = ['builtin', 'personal', 'plugin']

export function sourceGroupFor(skill: SkillSummary): SourceGroup {
  const source = String(skill.source || '')
  if (source === 'builtin') return 'builtin'
  if (source.startsWith('plugin:')) return 'plugin'
  return 'personal'
}

export function sourceGroupLabel(group: SourceGroup, scope: SkillsScope) {
  if (group === 'builtin') return t('skillsSourceBuiltin')
  if (group === 'plugin') return t('skillsSourcePlugin')
  return scope === 'project' ? t('skillsSourceProject') : t('skillsSourcePersonal')
}

export function sourceGroupHint(group: SourceGroup, scope: SkillsScope) {
  if (group === 'builtin') return t('skillsSourceBuiltinHint')
  if (group === 'plugin') return t('skillsSourcePluginHint')
  return scope === 'project' ? t('skillsSourceProjectHint') : t('skillsSourcePersonalHint')
}

export function sourcePathLabel(path: string, index: number, scope: SkillsScope) {
  if (path.includes('<enabled-plugin>')) return t('skillsSourcePlugin')
  if (path.includes('<project>')) return t('skillsSourceProject')
  const brand = path.includes('.quickforge')
    ? 'QuickForge'
    : path.includes('.claude')
      ? 'Claude'
      : path.includes('.opencode')
        ? 'OpenCode'
        : path.includes('.agents')
          ? 'Agents'
          : undefined
  if (!brand) return index === 0 ? t('skillsSourceBuiltin') : t('skillsPathNumber', { index: index + 1 })
  return scope === 'project' ? `${t('skillsSourceProject')} · ${brand}` : brand
}
