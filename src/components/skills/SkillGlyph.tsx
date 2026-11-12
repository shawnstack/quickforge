import { createElement } from 'react'
import {
  BookOpen,
  Code2,
  Database,
  FileText,
  FlaskConical,
  GitBranch,
  Globe2,
  Palette,
  Server,
  Sparkles,
  Tag,
  type LucideIcon,
} from 'lucide-react'
import type { SkillSummary } from '@/lib/types'

/** 按名称/显示名/标签的关键字猜一个最贴合的技能图标。 */
function skillIcon(skill: SkillSummary): LucideIcon {
  const haystack = `${skill.name} ${skill.displayName ?? ''} ${(skill.tags ?? []).join(' ')}`.toLowerCase()
  if (/skill|creator|prompt/.test(haystack)) return Sparkles
  if (/release|changelog|notes?/.test(haystack)) return Tag
  if (/git|commit|branch/.test(haystack)) return GitBranch
  if (/browser|playwright|web/.test(haystack)) return Globe2
  if (/pdf|document|markdown|file/.test(haystack)) return FileText
  if (/api|server|route|endpoint/.test(haystack)) return Server
  if (/data|csv|sql|log|cleanup/.test(haystack)) return Database
  if (/design|ui|palette|style/.test(haystack)) return Palette
  if (/test|review|qa/.test(haystack)) return FlaskConical
  if (/code/.test(haystack)) return Code2
  return BookOpen
}

export function SkillGlyph({ skill, className }: { skill: SkillSummary; className?: string }) {
  return createElement(skillIcon(skill), { className, 'aria-hidden': true })
}
