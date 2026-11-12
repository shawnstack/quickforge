import type { ProjectInfo, SkillSummary, SkillsScope } from '@/lib/types'

/**
 * Skills 域的 HTTP 客户端：集中 /api/skills 系列的请求构造、JSON 解析与错误处理。
 * 乐观更新与回滚的编排见 `src/hooks/use-skills-manager.ts`，这里只做纯请求。
 */

export type SkillsPayload = {
  skills: SkillSummary[]
  selectedSkills: string[]
  searchPaths?: string[]
}

export type SaveSkillsPayload = {
  selectedSkills: string[]
  projects?: ProjectInfo[]
}

export type SkillContent = {
  name: string
  displayName?: string | null
  description?: string | null
  version?: string | null
  tags?: string[]
  triggers?: string[]
  compatibility?: string | null
  allowedTools?: string | null
  license?: string | null
  source?: string | null
  instructions: string
  totalLines: number
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`)
  return payload as T
}

/** project 域要求 projectId 非空，由调用方（use-skills-manager）在加载守卫中保证。 */
export function fetchSkills(params: { scope: SkillsScope; projectId?: string }): Promise<SkillsPayload> {
  const url = params.scope === 'project'
    ? `/api/skills?projectId=${encodeURIComponent(params.projectId ?? '')}`
    : '/api/skills?scope=global'
  return requestJson<SkillsPayload>(url)
}

export function fetchSkillContent(params: { name: string; scope: SkillsScope; projectId?: string }): Promise<SkillContent> {
  const search = new URLSearchParams({ name: params.name })
  if (params.scope === 'project') {
    search.set('scope', 'project')
    search.set('projectId', params.projectId ?? '')
  } else {
    search.set('scope', 'global')
  }
  return requestJson<SkillContent>(`/api/skills/content?${search}`)
}

/** 保存选中集：project 域 PUT /api/skills/project，global 域 PUT /api/skills/global。 */
export function saveSkillsSelection(params: { scope: SkillsScope; projectId?: string; selectedSkills: string[] }): Promise<SaveSkillsPayload> {
  const isProjectScope = params.scope === 'project'
  return requestJson<SaveSkillsPayload>(isProjectScope ? '/api/skills/project' : '/api/skills/global', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(isProjectScope
      ? { projectId: params.projectId, selectedSkills: params.selectedSkills }
      : { selectedSkills: params.selectedSkills }),
  })
}
