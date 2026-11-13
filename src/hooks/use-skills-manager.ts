import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '@/lib/i18n'
import { invalidateSlashCatalog } from '@/lib/slash-catalog'
import {
  fetchSkillContent,
  fetchSkills,
  saveSkillsSelection,
  type SkillContent,
} from '@/lib/skills-client'
import type { ProjectInfo, SkillSummary, SkillsScope } from '@/lib/types'

/**
 * Skills 面板的完整数据层：列表/详情加载、选中集保存的乐观更新与回滚。
 * 从 skills-dialog 组件内抽出，HTTP 细节见 `@/lib/skills-client`。
 *
 * 保存编排沿用原实现的并发契约：
 * - saveQueueRef 串行队列：多个保存任务依次执行，前一个失败不阻断后一个（then(task, task)）；
 * - saveGenerationRef：任何一次保存失败即整体作废（generation+1），在途任务的结果全部丢弃并回滚到 confirmed 集；
 * - saveSequenceRef：只允许最新一次成功保存的服务端选中集覆盖本地乐观集（旧任务成功但不刷新界面）。
 */

export type SkillsSavedPayload = {
  scope: SkillsScope
  project?: ProjectInfo
  projects?: ProjectInfo[]
  selectedSkills: string[]
}

export type SelectionIntent = {
  bulk?: boolean
  message?: string
  undo?: Set<string>
}

export type ToastState = {
  message: string
  undo?: Set<string>
}

type UseSkillsManagerOptions = {
  active: boolean
  scope: SkillsScope
  project?: ProjectInfo
  onSaved: (payload: SkillsSavedPayload) => void
}

export function useSkillsManager({ active, scope, project, onSaved }: UseSkillsManagerOptions) {
  const isProjectScope = scope === 'project'
  const projectId = project?.id

  const [skills, setSkills] = useState<SkillSummary[]>([])
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(() => new Set())
  const [searchPaths, setSearchPaths] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const [pendingNames, setPendingNames] = useState<Set<string>>(() => new Set())
  const [bulkSaving, setBulkSaving] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)

  const [selectedSkillName, setSelectedSkillName] = useState<string | null>(null)
  const [skillContent, setSkillContent] = useState<SkillContent | null>(null)
  const [contentLoading, setContentLoading] = useState(false)
  const [contentError, setContentError] = useState('')

  const loadRequestRef = useRef(0)
  const contentRequestRef = useRef(0)
  const selectedSkillsRef = useRef<Set<string>>(new Set())
  const selectedSkillNameRef = useRef<string | null>(null)
  const confirmedSkillsRef = useRef<Set<string>>(new Set())
  const pendingNamesRef = useRef<Set<string>>(new Set())
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const saveGenerationRef = useRef(0)
  const saveSequenceRef = useRef(0)
  const toastTimerRef = useRef<number | null>(null)

  const busy = pendingNames.size > 0 || bulkSaving

  const setSelection = useCallback((next: Set<string>) => {
    selectedSkillsRef.current = next
    setSelectedSkills(next)
  }, [])

  const updatePending = useCallback((add: string[], remove: string[] = []) => {
    const next = new Set(pendingNamesRef.current)
    for (const name of add) next.add(name)
    for (const name of remove) next.delete(name)
    pendingNamesRef.current = next
    setPendingNames(new Set(next))
  }, [])

  const hideToast = useCallback(() => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current)
      toastTimerRef.current = null
    }
    setToast(null)
  }, [])

  const showToast = useCallback((message: string, undo?: Set<string>) => {
    hideToast()
    setToast({ message, undo })
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null)
      toastTimerRef.current = null
    }, undo ? 5000 : 2400)
  }, [hideToast])

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
  }, [])

  const loadSkills = useCallback(async (options?: { refresh?: boolean }) => {
    if (isProjectScope && !projectId) return false
    const requestId = ++loadRequestRef.current
    if (options?.refresh) setRefreshing(true)
    else setLoading(true)
    setError('')
    try {
      const payload = await fetchSkills({ scope, projectId })
      if (requestId !== loadRequestRef.current) return false
      const nextSkills = Array.isArray(payload.skills) ? payload.skills : []
      const nextSelected = new Set(Array.isArray(payload.selectedSkills) ? payload.selectedSkills : [])
      setSkills(nextSkills)
      setSelection(nextSelected)
      confirmedSkillsRef.current = new Set(nextSelected)
      setSearchPaths(Array.isArray(payload.searchPaths) ? payload.searchPaths : [])
      const currentSelected = selectedSkillNameRef.current
      if (currentSelected && !nextSkills.some((skill) => skill.name === currentSelected)) {
        selectedSkillNameRef.current = null
        setSelectedSkillName(null)
        setSkillContent(null)
        setContentError('')
      }
      return true
    } catch (loadError) {
      if (requestId === loadRequestRef.current) {
        setError(loadError instanceof Error ? loadError.message : t('failedToLoadSkills'))
      }
      return false
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [isProjectScope, projectId, scope, setSelection])

  useEffect(() => {
    if (!active || (isProjectScope && !projectId)) return
    const timer = window.setTimeout(() => {
      void loadSkills()
    }, 0)
    return () => {
      window.clearTimeout(timer)
      loadRequestRef.current += 1
    }
  }, [active, isProjectScope, loadSkills, projectId])

  const closeDetail = useCallback(() => {
    contentRequestRef.current += 1
    selectedSkillNameRef.current = null
    setSelectedSkillName(null)
    setSkillContent(null)
    setContentError('')
    setContentLoading(false)
  }, [])

  const loadSkillContent = useCallback(async (skillName: string) => {
    if (isProjectScope && !projectId) return
    const requestId = ++contentRequestRef.current
    setContentLoading(true)
    setContentError('')
    try {
      const payload = await fetchSkillContent({ name: skillName, scope, projectId })
      if (requestId !== contentRequestRef.current) return
      setSkillContent(payload)
    } catch (readError) {
      if (requestId === contentRequestRef.current) {
        setContentError(readError instanceof Error ? readError.message : t('failedToReadSkill'))
      }
    } finally {
      if (requestId === contentRequestRef.current) setContentLoading(false)
    }
  }, [isProjectScope, projectId, scope])

  const openSkill = useCallback((skill: SkillSummary) => {
    if (selectedSkillNameRef.current !== skill.name) {
      contentRequestRef.current += 1
      selectedSkillNameRef.current = skill.name
      setSelectedSkillName(skill.name)
      setSkillContent(null)
      setContentError('')
      setContentLoading(false)
      void loadSkillContent(skill.name)
    }
  }, [loadSkillContent])

  const removePending = useCallback((names: string[]) => {
    updatePending([], names)
  }, [updatePending])

  const queueSelection = useCallback((next: Set<string>, names: string[], intent: SelectionIntent = {}) => {
    const generation = saveGenerationRef.current
    const sequence = ++saveSequenceRef.current
    hideToast()
    setError('')
    updatePending(names)
    if (intent.bulk) setBulkSaving(true)
    setSelection(new Set(next))

    const task = async () => {
      if (generation !== saveGenerationRef.current) return
      try {
        const payload = await saveSkillsSelection({ scope, projectId, selectedSkills: [...next] })
        if (generation !== saveGenerationRef.current) return
        // The save is the write path for the composer "/" catalog: invalidate
        // here (the data layer) so every surface that saves — project dialog,
        // embedded settings tab, bulk enable — makes the new selection visible
        // immediately, instead of relying on each UI to remember it.
        invalidateSlashCatalog()
        const serverSelection = new Set(payload.selectedSkills)
        confirmedSkillsRef.current = serverSelection
        if (sequence === saveSequenceRef.current) setSelection(new Set(serverSelection))
        const updatedProject = isProjectScope && project
          ? payload.projects?.find((item) => item.id === project.id) ?? { ...project, skills: payload.selectedSkills }
          : undefined
        onSaved({
          scope,
          project: updatedProject,
          projects: payload.projects,
          selectedSkills: payload.selectedSkills,
        })
        if (intent.message) showToast(intent.message, intent.undo)
      } catch (saveError) {
        if (generation !== saveGenerationRef.current) return
        saveGenerationRef.current += 1
        saveSequenceRef.current += 1
        pendingNamesRef.current = new Set()
        setPendingNames(new Set())
        setBulkSaving(false)
        setSelection(new Set(confirmedSkillsRef.current))
        setError(saveError instanceof Error ? saveError.message : t('failedToSaveSkills'))
      } finally {
        if (generation === saveGenerationRef.current) {
          removePending(names)
          if (intent.bulk) setBulkSaving(false)
        }
      }
    }

    saveQueueRef.current = saveQueueRef.current.then(task, task)
  }, [hideToast, isProjectScope, onSaved, project, projectId, removePending, scope, setSelection, showToast, updatePending])

  const toggleSkill = useCallback((skillName: string) => {
    if (pendingNamesRef.current.has(skillName) || bulkSaving || loading) return
    const next = new Set(selectedSkillsRef.current)
    if (next.has(skillName)) next.delete(skillName)
    else next.add(skillName)
    queueSelection(next, [skillName])
  }, [bulkSaving, loading, queueSelection])

  const rescan = useCallback(async () => {
    const succeeded = await loadSkills({ refresh: true })
    if (!succeeded) return
    showToast(t('skillsRescanDone'))
    if (selectedSkillNameRef.current) void loadSkillContent(selectedSkillNameRef.current)
  }, [loadSkillContent, loadSkills, showToast])

  return {
    // 列表数据
    skills,
    selectedSkills,
    searchPaths,
    loading,
    refreshing,
    error,
    // 保存状态（乐观更新期间）
    pendingNames,
    bulkSaving,
    busy,
    // 保存结果 toast（含撤销集）
    toast,
    // 技能详情
    selectedSkillName,
    skillContent,
    contentLoading,
    contentError,
    // 动作
    reload: loadSkills,
    rescan,
    toggleSkill,
    queueSelection,
    openSkill,
    closeDetail,
    reloadSkillContent: loadSkillContent,
    hideToast,
    showToast,
  }
}
