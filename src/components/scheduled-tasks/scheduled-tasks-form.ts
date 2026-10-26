import { buildSchedulePayload, scheduleFormFromTask, scheduleValidationError } from '@/lib/scheduled-task-form'
import type { FormState, HistoryFilters, ParsedTask, ScheduledTask } from './scheduled-tasks-types'

export function defaultForm(): FormState {
  return {
    ...scheduleFormFromTask(),
    scheduleText: '',
    title: '',
    instruction: '',
    cronExpression: '',
    scheduleRule: '',
    nextRunAt: '',
    enabled: true,
    agentId: '',
    executionMode: 'serial',
  }
}

export function defaultHistoryFilters(): HistoryFilters {
  return {
    taskId: '',
    status: '',
    trigger: '',
    keyword: '',
    startedFrom: '',
    startedTo: '',
    page: 1,
    pageSize: 10,
  }
}

export function formFromTask(task: ScheduledTask): FormState {
  return {
    ...scheduleFormFromTask(task),
    scheduleText: [task.scheduleRule, task.instruction].filter(Boolean).join('\n'),
    title: task.title,
    instruction: task.instruction,
    cronExpression: task.cronExpression ?? '',
    scheduleRule: task.scheduleRule,
    nextRunAt: task.nextRunAt,
    enabled: task.status !== 'paused',
    agentId: task.agentId ?? '',
    executionMode: task.executionMode ?? 'serial',
  }
}

export function parsedTaskToForm(task: ParsedTask, current: FormState): FormState {
  const parsedSchedule = scheduleFormFromTask(task)
  return {
    ...current,
    ...parsedSchedule,
    onceExecuteAt: current.scheduleType === 'once' ? current.executeAt : current.onceExecuteAt,
    intervalExecuteAt: current.scheduleType === 'interval' ? current.executeAt : current.intervalExecuteAt,
    intervalValue: task.scheduleType === 'interval' ? parsedSchedule.intervalValue : current.intervalValue,
    intervalUnit: task.scheduleType === 'interval' ? parsedSchedule.intervalUnit : current.intervalUnit,
    originalExecuteAt: task.scheduleType === 'interval' ? parsedSchedule.originalExecuteAt : current.originalExecuteAt,
    title: task.title,
    instruction: task.instruction,
    cronExpression: task.cronExpression ?? '',
    scheduleRule: task.scheduleRule,
    nextRunAt: task.nextRunAt,
    enabled: current.enabled,
  }
}

export function buildTaskPayload(form: FormState) {
  return {
    title: form.title.trim(),
    instruction: form.instruction.trim(),
    ...buildSchedulePayload(form),
    enabled: form.enabled,
    agentId: form.agentId || null,
    executionMode: form.executionMode,
  }
}

export function formIsValid(form: FormState) {
  return Boolean(form.title.trim() && form.instruction.trim() && !scheduleValidationError(form))
}
