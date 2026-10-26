import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
import { useRef, useState } from 'react'
import { defaultForm, defaultHistoryFilters } from './scheduled-tasks-form'
import type {
  ActiveTab,
  AgentProfile,
  AnyModel,
  FormState,
  HistoryFilters,
  HistoryPayload,
  ParsedTask,
  ProjectOption,
  ScheduledTask,
  TaskMenuPosition,
} from './scheduled-tasks-types'

/**
 * Owns every piece of page state and the cross-render refs.
 *
 * The declaration order is part of the page contract: tests drive the page
 * through a hook-state harness that indexes `useState` / `useRef` slots.
 */
export function useScheduledTasksPageState() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [activeTab, setActiveTab] = useState<ActiveTab>('tasks')
  const [form, setForm] = useState<FormState>(() => defaultForm())
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null)
  const [openMenuTaskId, setOpenMenuTaskId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [parsedTask, setParsedTask] = useState<ParsedTask | null>(null)
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [models, setModels] = useState<AnyModel[]>([])
  const [selectedModel, setSelectedModel] = useState<AnyModel>()
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>('off')
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [historyFilters, setHistoryFilters] = useState<HistoryFilters>(() => defaultHistoryFilters())
  const [appliedHistoryFilters, setAppliedHistoryFilters] = useState<HistoryFilters>(() => defaultHistoryFilters())
  const [historyPayload, setHistoryPayload] = useState<HistoryPayload>({ runs: [], total: 0, page: 1, pageSize: 10 })
  const [historyLoading, setHistoryLoading] = useState(false)
  const [agentProfiles, setAgentProfiles] = useState<AgentProfile[]>([])
  const [pendingTaskIds, setPendingTaskIds] = useState<Set<string>>(() => new Set())
  const editorBusyRef = useRef(false)
  const editorGenerationRef = useRef(0)
  const editorOpenRef = useRef(false)
  const pendingTaskIdsRef = useRef(new Set<string>())
  const taskMenuPositionRef = useRef<TaskMenuPosition | null>(null)

  return {
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
  }
}
