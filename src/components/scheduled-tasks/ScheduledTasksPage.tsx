import { useEffect, useMemo } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { Edit3, Eye, Trash2, Zap } from 'lucide-react'
import { defaultThinkingLevelForModel } from '@/lib/pi-chat'
import { isModelSelectable } from '@/lib/model-visibility'
import { includeCurrentModel } from '@/lib/model-identity'
import { modelReferenceFromModel } from '@/lib/model-reference'
import { t } from '@/lib/i18n'
import { showConfirm } from '@/components/ui/confirm-dialog'

import { buildTaskPayload, defaultForm, defaultHistoryFilters, formFromTask, formIsValid, parsedTaskToForm } from './scheduled-tasks-form'
import { fetchAgentProfiles, fetchProjects, fetchScheduledTaskHistory, fetchScheduledTaskModelSettings, fetchScheduledTasks, requestJson } from './scheduled-tasks-data'
import { useScheduledTasksPageState } from './scheduled-tasks-state'
import { canRunTaskNow, renderTaskDetailView, renderTaskEditorView, renderTaskListView, taskHasRunningRuns } from './ScheduledTasksPageSections'
import type { FormState, HistoryFilters, ParsedTask, ScheduledTask } from './scheduled-tasks-types'

type ScheduledTasksPageProps = {
  onOpenSession?: (sessionId: string) => void
}

const taskMenuWidth = 144
const taskMenuHeight = 160
const taskMenuGap = 4
const taskMenuMargin = 8

export function ScheduledTasksPage({ onOpenSession }: ScheduledTasksPageProps) {
  const {
    tasks,
    setTasks,
    activeTab,
    setActiveTab,
    form,
    setForm,
    editingTaskId,
    setEditingTaskId,
    detailTaskId,
    setDetailTaskId,
    openMenuTaskId,
    setOpenMenuTaskId,
    dialogOpen,
    setDialogOpen,
    parsedTask,
    setParsedTask,
    question,
    setQuestion,
    loading,
    setLoading,
    error,
    setError,
    models,
    setModels,
    selectedModel,
    setSelectedModel,
    thinkingLevel,
    setThinkingLevel,
    projects,
    setProjects,
    selectedProjectId,
    setSelectedProjectId,
    historyFilters,
    setHistoryFilters,
    appliedHistoryFilters,
    setAppliedHistoryFilters,
    historyPayload,
    setHistoryPayload,
    historyLoading,
    setHistoryLoading,
    agentProfiles,
    setAgentProfiles,
    pendingTaskIds,
    setPendingTaskIds,
    editorBusyRef,
    editorGenerationRef,
    editorOpenRef,
    pendingTaskIdsRef,
    taskMenuPositionRef,
  } = useScheduledTasksPageState()
  const defaultProjectId = projects[0]?.id ?? ''

  useEffect(() => () => {
    editorGenerationRef.current += 1
    editorOpenRef.current = false
  }, [editorGenerationRef, editorOpenRef])

  useEffect(() => {
    if (!openMenuTaskId) return
    const closeMenu = () => setOpenMenuTaskId(null)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }
    window.addEventListener('click', closeMenu)
    window.addEventListener('blur', closeMenu)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('blur', closeMenu)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [openMenuTaskId, setOpenMenuTaskId])

  async function loadTasks() {
    setTasks(await fetchScheduledTasks())
  }

  async function loadHistory(filters = appliedHistoryFilters) {
    setHistoryLoading(true)
    setError('')
    try {
      const payload = await fetchScheduledTaskHistory(filters)
      setHistoryPayload(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      setHistoryLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    async function loadProjects() {
      try {
        const nextProjects = await fetchProjects()
        if (cancelled) return
        setProjects(nextProjects)
      } catch {
        // Project selection is optional.
      }
    }
    void loadProjects()
    return () => {
      cancelled = true
    }
  }, [setProjects])

  useEffect(() => {
    let cancelled = false
    async function loadModelSettings() {
      try {
        const settings = await fetchScheduledTaskModelSettings()
        if (cancelled) return
        setModels(settings.models)
        setSelectedModel(settings.selectedModel)
        setThinkingLevel(settings.thinkingLevel)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t('requestFailed'))
      }
    }
    void loadModelSettings()
    return () => {
      cancelled = true
    }
  }, [setError, setModels, setSelectedModel, setThinkingLevel])

  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      // Keep polling while the page is visible; a hidden tab should not keep
      // hitting the API (mobile browsers can keep timers alive for a long time).
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      try {
        const nextTasks = await fetchScheduledTasks()
        if (!cancelled) setTasks(nextTasks)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t('requestFailed'))
      }
    }
    const refreshWhenVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') void refresh()
    }
    void refresh()
    const timer = window.setInterval(refresh, 10 * 1000)
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [setError, setTasks])

  useEffect(() => {
    let cancelled = false
    async function loadInitialAgents() {
      try {
        const nextAgents = await fetchAgentProfiles()
        if (cancelled) return
        setAgentProfiles(nextAgents)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t('requestFailed'))
      }
    }
    void loadInitialAgents()
    return () => {
      cancelled = true
    }
  }, [setAgentProfiles, setError])

  const editingTask = useMemo(() => tasks.find((task) => task.id === editingTaskId), [editingTaskId, tasks])
  const selectableModels = useMemo(() => models.filter(isModelSelectable), [models])
  const modelOptions = useMemo(
    () => includeCurrentModel(selectableModels, selectedModel),
    [selectableModels, selectedModel],
  )
  const detailTask = useMemo(() => tasks.find((task) => task.id === detailTaskId) ?? null, [detailTaskId, tasks])
  const openMenuTask = openMenuTaskId ? tasks.find((task) => task.id === openMenuTaskId) ?? null : null
  const enabledCount = useMemo(() => tasks.filter((task) => task.status === 'enabled').length, [tasks])
  const totalHistoryPages = Math.max(1, Math.ceil(historyPayload.total / historyPayload.pageSize))

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    if (editorBusyRef.current) return
    setForm((current) => {
      const next = { ...current, [key]: value, nextRunAt: '', scheduleRule: '' }
      if (key === 'scheduleType') {
        if (current.scheduleType === 'once') next.onceExecuteAt = current.executeAt
        if (current.scheduleType === 'interval') next.intervalExecuteAt = current.executeAt
        if (value === 'once') next.executeAt = next.onceExecuteAt
        if (value === 'interval') next.executeAt = next.intervalExecuteAt
      }
      return next
    })
    setParsedTask(null)
    setQuestion('')
  }

  function updateHistoryFilter<K extends keyof HistoryFilters>(key: K, value: HistoryFilters[K]) {
    setHistoryFilters((current) => ({ ...current, [key]: value }))
  }

  function resetEditor() {
    const defaultModel = models.find(isModelSelectable)
    setEditingTaskId(null)
    setSelectedProjectId(defaultProjectId)
    setSelectedModel(defaultModel)
    setThinkingLevel(defaultThinkingLevelForModel(defaultModel))
    setForm(defaultForm())
    setParsedTask(null)
    setQuestion('')
    setError('')
  }

  function openCreateDialog() {
    if (editorBusyRef.current) return
    editorGenerationRef.current += 1
    editorOpenRef.current = true
    resetEditor()
    setDialogOpen(true)
  }

  function finishEditor() {
    editorGenerationRef.current += 1
    editorOpenRef.current = false
    setDialogOpen(false)
    resetEditor()
  }

  function closeDialog() {
    if (editorBusyRef.current) return
    finishEditor()
  }

  function applyHistoryFilters() {
    const nextFilters = { ...historyFilters, page: 1 }
    setHistoryFilters(nextFilters)
    setAppliedHistoryFilters(nextFilters)
    void loadHistory(nextFilters)
  }

  function resetHistoryFilters() {
    const nextFilters = defaultHistoryFilters()
    setHistoryFilters(nextFilters)
    setAppliedHistoryFilters(nextFilters)
    void loadHistory(nextFilters)
  }

  function changeHistoryPage(page: number) {
    const nextPage = Math.min(Math.max(1, page), totalHistoryPages)
    const nextFilters = { ...appliedHistoryFilters, page: nextPage }
    setHistoryFilters(nextFilters)
    setAppliedHistoryFilters(nextFilters)
    void loadHistory(nextFilters)
  }

  function changeHistoryPageSize(pageSize: number) {
    const nextFilters = { ...appliedHistoryFilters, page: 1, pageSize }
    setHistoryFilters(nextFilters)
    setAppliedHistoryFilters(nextFilters)
    void loadHistory(nextFilters)
  }

  async function handleParse() {
    const scheduleText = form.scheduleText.trim()
    if (editorBusyRef.current || !editorOpenRef.current || !selectedModel || !scheduleText) return
    editorBusyRef.current = true
    const generation = editorGenerationRef.current
    setLoading(true)
    setError('')
    try {
      const result = await requestJson<{ needMoreInfo: boolean; question?: string; task?: ParsedTask }>('/api/scheduled-tasks/parse', {
        method: 'POST',
        body: JSON.stringify({ instruction: scheduleText, modelRef: selectedModel ? modelReferenceFromModel(selectedModel) : undefined, model: selectedModel, thinkingLevel }),
      })
      if (!editorOpenRef.current || editorGenerationRef.current !== generation) return
      if (result.needMoreInfo || !result.task) {
        setQuestion(result.question || t('taskNeedMoreInfo'))
        setParsedTask(null)
        return
      }
      const task = result.task
      setQuestion('')
      setParsedTask(task)
      setForm((current) => parsedTaskToForm(task, current))
    } catch (err) {
      if (editorOpenRef.current && editorGenerationRef.current === generation) setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      editorBusyRef.current = false
      setLoading(false)
    }
  }

  async function handleSave() {
    if (editorBusyRef.current || !editorOpenRef.current || !selectedModel || !formIsValid(form)) return
    editorBusyRef.current = true
    const generation = editorGenerationRef.current
    setLoading(true)
    setError('')
    try {
      const selectedProject = projects.find((project) => project.id === selectedProjectId)
      const payload = {
        task: buildTaskPayload(form),
        modelRef: selectedModel ? modelReferenceFromModel(selectedModel) : undefined,
        model: selectedModel,
        thinkingLevel,
        projectId: selectedProject?.id,
        projectName: selectedProject?.name,
      }
      if (editingTaskId) {
        await requestJson(`/api/scheduled-tasks/${encodeURIComponent(editingTaskId)}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        })
      } else {
        await requestJson('/api/scheduled-tasks', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
      }
      if (editorOpenRef.current && editorGenerationRef.current === generation) finishEditor()
      await loadTasks()
      if (activeTab === 'history') await loadHistory(appliedHistoryFilters)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      editorBusyRef.current = false
      setLoading(false)
    }
  }

  function toggleTaskMenu(event: ReactMouseEvent<HTMLButtonElement>, taskId: string) {
    if (openMenuTaskId === taskId) {
      setOpenMenuTaskId(null)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const left = Math.max(
      taskMenuMargin,
      Math.min(rect.right - taskMenuWidth, window.innerWidth - taskMenuWidth - taskMenuMargin),
    )
    const below = rect.bottom + taskMenuGap
    const above = rect.top - taskMenuGap - taskMenuHeight
    const top = below + taskMenuHeight <= window.innerHeight - taskMenuMargin
      ? below
      : Math.max(taskMenuMargin, above)
    taskMenuPositionRef.current = { left, top }
    setOpenMenuTaskId(taskId)
  }

  function startEdit(task: ScheduledTask) {
    if (editorBusyRef.current || pendingTaskIdsRef.current.has(task.id)) return
    editorGenerationRef.current += 1
    editorOpenRef.current = true
    setOpenMenuTaskId(null)
    setEditingTaskId(task.id)
    setForm(formFromTask(task))
    setParsedTask(null)
    setQuestion('')
    setError('')
    setSelectedProjectId(task.projectId ?? '')
    if (task.model) setSelectedModel(task.model)
    if (task.thinkingLevel) setThinkingLevel(task.thinkingLevel)
    setDialogOpen(true)
  }

  async function taskAction(taskId: string, action: 'run' | 'pause' | 'resume' | 'delete') {
    if (pendingTaskIdsRef.current.has(taskId) || editorBusyRef.current) return
    pendingTaskIdsRef.current.add(taskId)
    setPendingTaskIds(new Set(pendingTaskIdsRef.current))
    setError('')
    setOpenMenuTaskId(null)
    try {
      if (action === 'delete') {
        const confirmed = await showConfirm({
          description: t('confirmDeleteTask'),
          confirmLabel: t('confirmDelete'),
          cancelLabel: t('cancel'),
          variant: 'destructive',
        })
        if (!confirmed) return
      }
      if (action === 'delete') {
        await requestJson(`/api/scheduled-tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' })
        if (editingTaskId === taskId) closeDialog()
        if (detailTaskId === taskId) setDetailTaskId(null)
      } else {
        await requestJson(`/api/scheduled-tasks/${encodeURIComponent(taskId)}/${action}`, { method: 'POST' })
      }
      await loadTasks()
      if (activeTab === 'history') await loadHistory(appliedHistoryFilters)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('requestFailed'))
    } finally {
      pendingTaskIdsRef.current.delete(taskId)
      setPendingTaskIds(new Set(pendingTaskIdsRef.current))
    }
  }

  // The three view renderers only build elements; the handler closures they
  // receive are invoked from events, never while rendering.
  /* eslint-disable react-hooks/refs */
  let view
  if (dialogOpen) {
    view = renderTaskEditorView({
      editingTask,
      form,
      question,
      parsedTask,
      loading,
      error,
      selectedModel,
      modelOptions,
      thinkingLevel,
      projects,
      selectedProjectId,
      agentProfiles,
      updateForm,
      setSelectedModel,
      setThinkingLevel,
      setSelectedProjectId,
      handleParse,
      handleSave,
      closeDialog,
    })
  } else if (detailTask) {
    view = renderTaskDetailView({
      detailTask,
      pendingTaskIds,
      agentProfiles,
      setDetailTaskId,
      taskAction,
      startEdit,
      onOpenSession,
    })
  } else {
    view = renderTaskListView({
      tasks,
      activeTab,
      enabledCount,
      error,
      loading,
      openMenuTaskId,
      pendingTaskIds,
      historyFilters,
      historyPayload,
      historyLoading,
      totalHistoryPages,
      appliedHistoryFilters,
      setActiveTab,
      setDetailTaskId,
      openCreateDialog,
      loadHistory,
      updateHistoryFilter,
      resetHistoryFilters,
      applyHistoryFilters,
      changeHistoryPage,
      changeHistoryPageSize,
      toggleTaskMenu,
      taskAction,
      onOpenSession,
    })
  }
  /* eslint-enable react-hooks/refs */

  return (
    <>
      {view}

      {openMenuTask ? createPortal(
        <div
          ref={(node) => {
            const position = taskMenuPositionRef.current
            if (node && position) {
              node.style.left = `${position.left}px`
              node.style.top = `${position.top}px`
            }
          }}
          className="fixed z-50 w-36 overflow-hidden rounded-xl border border-border bg-popover py-1 text-sm shadow-quickforge"
          role="menu"
          aria-label={t('moreActions')}
          onClick={(event) => event.stopPropagation()}
        >
          <button className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50" disabled={pendingTaskIds.has(openMenuTask.id) || !canRunTaskNow(openMenuTask)} onClick={() => taskAction(openMenuTask.id, 'run')}>
            <Zap className="size-4" />{t('executeNow')}
          </button>
          <button className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50" disabled={pendingTaskIds.has(openMenuTask.id) || taskHasRunningRuns(openMenuTask)} onClick={() => startEdit(openMenuTask)}>
            <Edit3 className="size-4" />{t('editTask')}
          </button>
          <button className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted" onClick={() => { setOpenMenuTaskId(null); setDetailTaskId(openMenuTask.id) }}>
            <Eye className="size-4" />{t('viewDetails')}
          </button>
          <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50" disabled={pendingTaskIds.has(openMenuTask.id) || taskHasRunningRuns(openMenuTask)} onClick={() => taskAction(openMenuTask.id, 'delete')}>
            <Trash2 className="size-4" />{t('deleteTask')}
          </button>
        </div>,
        document.body,
      ) : null}

    </>
  )
}
