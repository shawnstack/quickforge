import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { NewChatProjectPicker } from '../../src/components/chat/NewChatProjectPicker'
import { t } from '../../src/lib/i18n'
import type { ProjectInfo } from '../../src/lib/types'

const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')

const project: ProjectInfo = {
  id: 'project-1',
  name: 'quickforge',
  path: 'D:\\quickforge',
  lastOpenedAt: '2026-10-21T00:00:00.000Z',
}

function renderPicker(branch?: string, hasSelectedProject = true, withBranchMenu = true): string {
  return renderToStaticMarkup(createElement(NewChatProjectPicker, {
    projects: [project],
    selectedProject: hasSelectedProject ? project : undefined,
    branch,
    branchMenu: withBranchMenu ? {
      projectId: project.id,
      dirtyCount: 2,
      onCheckout: async () => {},
      onCreated: () => {},
      onOpenGraph: () => {},
      onOpenChanges: () => {},
    } : undefined,
    onSelectProject: () => {},
    onClearProject: () => {},
    onNewProject: () => {},
  }))
}

describe('new chat project row', () => {
  it('renders the branch beside the selected project when one exists', () => {
    const markup = renderPicker('dev')

    expect(markup).toContain('quickforge-empty-project-branch')
    expect(markup).toContain('>dev<')
    expect(markup).toContain(t('gitBranchLabel', { branch: 'dev' }))
    expect(markup).toContain('aria-haspopup="menu"')
    expect(markup).toContain('aria-expanded="false"')
  })

  it('omits the branch without a git branch or a selected project', () => {
    expect(renderPicker(undefined)).not.toContain('quickforge-empty-project-branch')
    expect(renderPicker('   ')).not.toContain('quickforge-empty-project-branch')
    expect(renderPicker('dev', false)).not.toContain('quickforge-empty-project-branch')
  })

  it('drops the default backgrounds and keeps the branch next to the project', () => {
    const triggerRule = css.match(/\.quickforge-empty-project-trigger \{([^}]*)\}/)?.[1] ?? ''
    const chipRule = css.match(/\.quickforge-empty-project-chip \{([^}]*)\}/)?.[1] ?? ''
    const branchRule = css.match(/\.quickforge-empty-project-branch \{([^}]*)\}/)?.[1] ?? ''

    expect(triggerRule).not.toMatch(/background/)
    expect(chipRule).toContain('background: transparent')
    expect(branchRule).not.toContain('margin-left: auto')
  })

  it('wires the branch and reused selector from the current project git status', () => {
    expect(appSource).toContain("branch={agentManager.chatScope === 'project' && titleGitStatus?.isGitRepository ? titleGitStatus.branch : undefined}")
    expect(appSource).toContain("branchMenu={agentManager.chatScope === 'project'")
    expect(appSource).toContain('onCheckout: handleCheckoutTitleBranch')
    expect(appSource).toContain('onCreated: handleBranchCreated')
  })
})
