// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getGitBranchesMock } = vi.hoisted(() => ({ getGitBranchesMock: vi.fn() }))

vi.mock('../../src/components/workspace/workspace-api', () => ({
  getGitBranches: getGitBranchesMock,
  createGitBranch: vi.fn(),
}))

import { NewChatProjectPicker } from '../../src/components/chat/NewChatProjectPicker'
import type { ProjectInfo } from '../../src/lib/types'

const project: ProjectInfo = {
  id: 'project-1',
  name: 'quickforge',
  path: 'D:\\quickforge',
  lastOpenedAt: '2026-10-21T00:00:00.000Z',
}

describe('new chat branch selector', () => {
  let container: HTMLDivElement
  let root: Root
  const onCheckout = vi.fn(async () => {})

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    getGitBranchesMock.mockResolvedValue({
      branches: [
        { name: 'main', current: false },
        { name: 'dev', current: true },
      ],
    })
    onCheckout.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root.render(createElement(NewChatProjectPicker, {
        projects: [project],
        selectedProject: project,
        branch: 'dev',
        branchMenu: {
          projectId: project.id,
          dirtyCount: 1,
          onCheckout,
          onCreated: () => {},
          onOpenGraph: () => {},
          onOpenChanges: () => {},
        },
        onSelectProject: () => {},
        onClearProject: () => {},
        onNewProject: () => {},
      }))
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.innerHTML = ''
  })

  async function flush() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  it('opens the reused branch menu from the branch chip', async () => {
    const trigger = container.querySelector<HTMLButtonElement>('button.quickforge-empty-project-branch')
    expect(trigger).not.toBeNull()
    expect(trigger?.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger?.getAttribute('aria-expanded')).toBe('false')

    await act(async () => {
      trigger?.click()
    })
    await flush()

    expect(trigger?.getAttribute('aria-expanded')).toBe('true')
    expect(getGitBranchesMock).toHaveBeenCalledWith(project.id)
    const menu = document.querySelector<HTMLElement>('.quickforge-empty-project-branch-menu')
    expect(menu).not.toBeNull()
    expect(menu?.textContent).toContain('main')
    expect(menu?.textContent).toContain('dev')
  })

  it('reuses checkout and closes the menu after switching branch', async () => {
    const trigger = container.querySelector<HTMLButtonElement>('button.quickforge-empty-project-branch')
    await act(async () => {
      trigger?.click()
    })
    await flush()

    const main = Array.from(document.querySelectorAll<HTMLButtonElement>('.quickforge-empty-project-branch-menu button'))
      .find((button) => button.textContent?.includes('main'))
    expect(main).toBeDefined()

    await act(async () => {
      main?.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(onCheckout).toHaveBeenCalledWith('main')
    expect(document.querySelector('.quickforge-empty-project-branch-menu')).toBeNull()
  })
})
