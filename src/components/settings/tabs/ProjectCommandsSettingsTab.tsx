import { useEffect, useRef, useState } from 'react'
import { t } from '@/lib/i18n'
import { showPrompt } from '@/components/ui/prompt-dialog'
import type { ProjectInfo } from '@/lib/types'
import { InfoTip } from '@/components/ui/info-tip'

type CommandSummary = {
  name: string
  description?: string
  argumentHint?: string
  relativePath?: string
}

type CreateCommandResult = { ok: boolean; reason?: string; name?: string }

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : undefined),
      ...init?.headers,
    },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || t('requestFailed'))
  return payload as T
}

/** 取首个非空行（trim）作为命令目录；全空回退 `.ai/commands`。供单测直接覆盖。 */
function resolvePrimaryCommandDir(commandDir: string) {
  const firstLine = commandDir
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  return firstLine || '.ai/commands'
}

/** 打开解析后的命令目录（POST /api/project/open-path）；失败抛错由调用方展示。 */
async function openCommandDirectory(projectId: string, commandDir: string) {
  await requestJson('/api/project/open-path', {
    method: 'POST',
    body: JSON.stringify({ path: resolvePrimaryCommandDir(commandDir), projectId }),
  })
}

/** 创建斜杠命令（POST /api/project/command）；HTTP 失败抛错，业务结果原样返回。 */
async function submitNewCommand(projectId: string, name: string) {
  return requestJson<CreateCommandResult>('/api/project/command', {
    method: 'POST',
    body: JSON.stringify({ name, projectId }),
  })
}

export function ProjectCommandsSettingsTab() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [project, setProject] = useState<ProjectInfo | undefined>(undefined)
  const [commandDir, setCommandDir] = useState('')
  const [commands, setCommands] = useState<CommandSummary[]>([])
  const [loadingCommands, setLoadingCommands] = useState(false)

  // 防抖保存与并发合并需要跨渲染读取最新 project / commandDir / saving，用 ref 镜像。
  const projectRef = useRef(project)
  const commandDirRef = useRef(commandDir)
  const savingRef = useRef(saving)
  const saveTimerRef = useRef<number | null>(null)
  const lastSavedCommandDirRef = useRef('')
  const pendingSaveAfterCurrentRef = useRef(false)

  const loadCommands = async (target: ProjectInfo) => {
    if (!target.id) return
    setLoadingCommands(true)
    try {
      const payload = await requestJson<{ commands: CommandSummary[] }>(
        `/api/project/commands?projectId=${encodeURIComponent(target.id)}`,
      )
      if (projectRef.current?.id === target.id) setCommands(payload?.commands ?? [])
    } catch {
      if (projectRef.current?.id === target.id) setCommands([])
    } finally {
      setLoadingCommands(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    void requestJson<{ project?: ProjectInfo; projects?: ProjectInfo[] }>('/api/project')
      .then(async (payload) => {
        if (cancelled) return
        const nextProjects = payload?.projects ?? (payload?.project ? [payload.project] : [])
        const nextProject = payload?.project ?? nextProjects[0]
        const nextCommandDir = typeof nextProject?.commandDir === 'string' ? nextProject.commandDir : ''
        setProjects(nextProjects)
        setProject(nextProject)
        projectRef.current = nextProject
        setCommandDir(nextCommandDir)
        commandDirRef.current = nextCommandDir
        lastSavedCommandDirRef.current = nextCommandDir
        if (nextProject) await loadCommands(nextProject)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t('requestFailed'))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => {
      cancelled = true
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
     
  }, [])

  const clearSaveTimer = () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
  }

  const scheduleSave = () => {
    clearSaveTimer()
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void save()
    }, 800)
  }

  const save = async () => {
    const currentProject = projectRef.current
    if (!currentProject) return
    if (savingRef.current) {
      pendingSaveAfterCurrentRef.current = true
      return
    }

    const projectId = currentProject.id
    const dir = commandDirRef.current
    if (dir === lastSavedCommandDirRef.current) return

    setSaving(true)
    savingRef.current = true
    setSaved(false)
    setError('')
    setMessage('')

    try {
      const payload = await requestJson<{ project?: ProjectInfo }>(
        `/api/project/${encodeURIComponent(projectId)}/command-dir`,
        { method: 'PUT', body: JSON.stringify({ commandDir: dir }) },
      )
      if (projectRef.current?.id === projectId) {
        const nextProject = payload?.project ?? projectRef.current
        setProject(nextProject)
        projectRef.current = nextProject
        setProjects((current) => {
          const index = current.findIndex((item) => item.id === nextProject.id)
          if (index < 0) return current
          const copy = [...current]
          copy[index] = nextProject
          return copy
        })
        const nextCommandDir = typeof nextProject.commandDir === 'string' ? nextProject.commandDir : dir
        // A response must not overwrite edits made while the request was pending.
        lastSavedCommandDirRef.current = nextCommandDir
        if (commandDirRef.current === dir) {
          setCommandDir(nextCommandDir)
          commandDirRef.current = nextCommandDir
          setSaved(true)
        } else {
          pendingSaveAfterCurrentRef.current = true
        }
        await loadCommands(nextProject)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      setSaving(false)
      savingRef.current = false
      if (pendingSaveAfterCurrentRef.current) {
        pendingSaveAfterCurrentRef.current = false
        scheduleSave()
      }
    }
  }

  const selectProject = (projectId: string) => {
    clearSaveTimer()
    const selected = projects.find((item) => item.id === projectId)
    if (!selected) return
    const nextCommandDir = typeof selected.commandDir === 'string' ? selected.commandDir : ''
    setProject(selected)
    projectRef.current = selected
    setCommandDir(nextCommandDir)
    commandDirRef.current = nextCommandDir
    lastSavedCommandDirRef.current = nextCommandDir
    setSaved(false)
    setMessage('')
    setError('')
    setCommands([])
    void loadCommands(selected)
  }

  const updateCommandDir = (value: string) => {
    setCommandDir(value)
    commandDirRef.current = value
    setSaved(false)
    setMessage('')
    scheduleSave()
  }

  const openCommandDir = async () => {
    const currentProject = projectRef.current
    if (!currentProject) return
    setError('')
    setMessage('')
    try {
      await openCommandDirectory(currentProject.id, commandDirRef.current)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    }
  }

  const createCommand = async () => {
    const currentProject = projectRef.current
    if (!currentProject) return
    const name = await showPrompt({
      title: t('newCommandPrompt'),
      placeholder: t('newCommandNamePlaceholder'),
      confirmLabel: t('createCommand'),
      cancelLabel: t('cancel'),
    })
    if (!name) return
    setError('')
    setMessage('')
    try {
      const result = await submitNewCommand(currentProject.id, name)
      if (result.ok) {
        setMessage(t('commandCreated', { name: result.name ?? name }))
        await loadCommands(currentProject)
      } else if (result.reason === 'exists') {
        setError(t('commandAlreadyExists', { name: result.name ?? name }))
      } else {
        setError(t('invalidCommandName'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    }
  }

  if (loading) {
    return <div className="quickforge-settings-note">{t('loading')}</div>
  }

  if (projects.length === 0) {
    return (
      <div className="quickforge-settings-stack">
        <div className="quickforge-settings-note">{t('selectProjectForCommands')}</div>
        {error ? <div className="quickforge-settings-alert">{error}</div> : null}
      </div>
    )
  }

  return (
    <div className="quickforge-settings-stack">
      <section className="quickforge-settings-section" aria-label={t('projectCommands')}>
        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">{t('project')}</div>
            <div className="quickforge-settings-row-description">
              {project?.path ? project.path : t('projectCommandsProjectDescription')}
            </div>
          </div>
          <div className="quickforge-settings-row-control quickforge-settings-row-control-wide">
            <select
              className="quickforge-settings-select"
              value={project?.id ?? ''}
              onChange={(event) => selectProject(event.currentTarget.value)}
            >
              {projects.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="quickforge-settings-row quickforge-settings-row-align-start">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">
              {t('commandDirectories')}
              <InfoTip label={t('commandDirectoryHelp')} />
            </div>
            <div className="quickforge-settings-row-description">{t('commandDirectoriesDescription')}</div>
          </div>
          <div className="quickforge-settings-row-control quickforge-settings-row-control-wide">
            <textarea
              className="quickforge-settings-textarea quickforge-settings-mono"
              value={commandDir}
              placeholder={t('commandDirectoryPlaceholder')}
              onChange={(event) => updateCommandDir(event.currentTarget.value)}
            ></textarea>
          </div>
        </div>

        <div className="quickforge-settings-row quickforge-settings-row-align-start">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">{t('commandDirectoryExamples')}</div>
            <div className="quickforge-settings-row-description">{t('commandDirectoryExamplesDescription')}</div>
          </div>
          <div className="quickforge-settings-row-control quickforge-settings-row-control-wide quickforge-settings-code-list">
            <code>.ai/commands</code>
            <code>.claude/commands</code>
            <code>.opencode/commands</code>
            <code>D:\shared\ai-commands</code>
          </div>
        </div>
      </section>

      <section className="quickforge-settings-section" aria-label={t('loadedCommands', { count: commands.length })}>
        <div className="quickforge-settings-row">
          <div className="quickforge-settings-row-main">
            <div className="quickforge-settings-row-title">{t('loadedCommands', { count: commands.length })}</div>
            <div className="quickforge-settings-row-description">{t('loadedCommandsDescription')}</div>
          </div>
          <div className="quickforge-settings-row-control quickforge-settings-row-control-wide">
            <button
              className="quickforge-settings-button quickforge-settings-button-secondary"
              type="button"
              disabled={loadingCommands}
              onClick={() => void openCommandDir()}
            >
              {t('openCommandDir')}
            </button>
            <button
              className="quickforge-settings-button quickforge-settings-button-primary"
              type="button"
              disabled={loadingCommands}
              onClick={() => void createCommand()}
            >
              {t('createCommand')}
            </button>
          </div>
        </div>

        <div className="quickforge-settings-nested-list">
          {loadingCommands
            ? <div className="quickforge-settings-empty-row">{t('loading')}</div>
            : commands.length === 0
              ? <div className="quickforge-settings-empty-row">{t('noCommandsLoaded')}</div>
              : commands.map((command) => {
                const hint = command.argumentHint ? ` ${command.argumentHint}` : ''
                return (
                  <div className="quickforge-settings-subrow" key={`${command.name}:${command.relativePath ?? ''}`}>
                    <div className="quickforge-settings-row-main">
                      <div className="quickforge-settings-row-title">
                        <code className="quickforge-settings-command-name">/{command.name}{hint}</code>
                      </div>
                      <div className="quickforge-settings-row-description">
                        {command.description || t('noDescription')}
                      </div>
                    </div>
                    {command.relativePath
                      ? (
                        <div className="quickforge-settings-row-control quickforge-settings-row-control-wide quickforge-settings-readonly-value">
                          {command.relativePath}
                        </div>
                      )
                      : null}
                  </div>
                )
              })}
        </div>
      </section>

      {saving ? <div className="quickforge-settings-note">{t('saving')}</div> : null}
      {saved ? <div className="quickforge-settings-message">{t('projectCommandsSaved')}</div> : null}
      {message ? <div className="quickforge-settings-message">{message}</div> : null}
      {error ? <div className="quickforge-settings-alert">{error}</div> : null}
    </div>
  )
}
