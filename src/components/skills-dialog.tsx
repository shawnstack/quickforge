import { useEffect, useMemo, useState } from 'react'
import { Check, Loader2, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import type { ProjectInfo, SkillSummary } from '@/lib/types'

type SkillsDialogProps = {
  open: boolean
  project?: ProjectInfo
  onOpenChange: (open: boolean) => void
  onSaved: (project: ProjectInfo, projects: ProjectInfo[]) => void
}

type SkillsPayload = {
  skills: SkillSummary[]
  selectedSkills: string[]
}

type SavePayload = {
  selectedSkills: string[]
  projects: ProjectInfo[]
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`)
  return payload as T
}

export function SkillsDialog({ open, project, onOpenChange, onSaved }: SkillsDialogProps) {
  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(() => new Set())
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !project) return

    let disposed = false
    const loadSkills = async () => {
      setLoading(true)
      setError('')
      try {
        const response = await fetch(`/api/skills?projectId=${encodeURIComponent(project.id)}`)
        const payload = await readJsonResponse<SkillsPayload>(response)
        if (disposed) return
        setSkills(Array.isArray(payload.skills) ? payload.skills : [])
        setSelectedSkills(new Set(Array.isArray(payload.selectedSkills) ? payload.selectedSkills : []))
      } catch (loadError) {
        if (!disposed) setError(loadError instanceof Error ? loadError.message : t('failedToLoadSkills'))
      } finally {
        if (!disposed) setLoading(false)
      }
    }

    void loadSkills()
    return () => {
      disposed = true
    }
  }, [open, project])

  useEffect(() => {
    if (!open) return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onOpenChange(false)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onOpenChange, open, saving])

  const filteredSkills = useMemo(() => {
    const text = query.trim().toLowerCase()
    if (!text) return skills
    return skills.filter((skill) => {
      const haystack = [
        skill.name,
        skill.displayName,
        skill.description,
        ...(skill.tags ?? []),
        ...(skill.triggers ?? []),
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(text)
    })
  }, [query, skills])

  if (!open || !project) return null

  const toggleSkill = (skillName: string) => {
    setSelectedSkills((current) => {
      const next = new Set(current)
      if (next.has(skillName)) next.delete(skillName)
      else next.add(skillName)
      return next
    })
  }

  const save = async () => {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const response = await fetch('/api/skills/project', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, selectedSkills: [...selectedSkills] }),
      })
      const payload = await readJsonResponse<SavePayload>(response)
      const updatedProject = payload.projects.find((item) => item.id === project.id) ?? { ...project, skills: payload.selectedSkills }
      onSaved(updatedProject, payload.projects)
      onOpenChange(false)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('failedToSaveSkills'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) onOpenChange(false)
      }}
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-background shadow-xl">
        <div className="border-b border-border p-4">
          <h2 className="text-base font-semibold text-foreground">{t('skills')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('skillsDescription', { project: project.name })}
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2">
            <Search className="size-4 shrink-0 text-muted-foreground/60" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('searchSkills')}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/45"
              disabled={loading || saving}
            />
          </div>

          {error ? <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}

          <div className="rounded-md border border-border">
            <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs text-muted-foreground">
              <span>{t('availableSkills')}</span>
              <span>{t('selectedSkillsCount', { count: selectedSkills.size })}</span>
            </div>
            <div className="max-h-[46vh] overflow-y-auto p-1">
              {loading ? (
                <div className="flex items-center justify-center gap-2 px-3 py-8 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  {t('loading')}
                </div>
              ) : filteredSkills.length === 0 ? (
                <div className="px-3 py-8 text-center text-sm text-muted-foreground">{t('noMatchingSkills')}</div>
              ) : (
                filteredSkills.map((skill) => {
                  const checked = selectedSkills.has(skill.name)
                  return (
                    <button
                      key={skill.name}
                      type="button"
                      className={cn(
                        'flex w-full items-start gap-3 rounded-md px-3 py-3 text-left text-sm transition-colors hover:bg-secondary disabled:opacity-50',
                        checked && 'bg-secondary/70',
                      )}
                      onClick={() => toggleSkill(skill.name)}
                      disabled={saving}
                    >
                      <span className={cn(
                        'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border border-input',
                        checked && 'border-primary bg-primary text-primary-foreground',
                      )}>
                        {checked ? <Check className="size-3.5" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-foreground/90">
                          {skill.displayName || skill.name}
                        </span>
                        {skill.description ? (
                          <span className="mt-0.5 block text-xs leading-5 text-muted-foreground/70">{skill.description}</span>
                        ) : null}
                        {skill.tags?.length ? (
                          <span className="mt-2 flex flex-wrap gap-1">
                            {skill.tags.slice(0, 5).map((tag) => (
                              <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                                {tag}
                              </span>
                            ))}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border p-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('cancel')}
          </Button>
          <Button type="button" onClick={save} disabled={loading || saving}>
            {saving ? t('saving') : t('save')}
          </Button>
        </div>
      </div>
    </div>
  )
}
