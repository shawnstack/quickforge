import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const pickerSource = readFileSync(new URL('../../src/components/chat/NewChatProjectPicker.tsx', import.meta.url), 'utf8')
const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')
const projectHookSource = readFileSync(new URL('../../src/hooks/useProject.ts', import.meta.url), 'utf8')
const projectRouteSource = readFileSync(new URL('../../server/routes/project.mjs', import.meta.url), 'utf8')
const projectConfigSource = readFileSync(new URL('../../server/project-config.mjs', import.meta.url), 'utf8')
const i18nSource = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')
const emptyStateCss = readFileSync(new URL('../../src/styles/chat/empty-state.css', import.meta.url), 'utf8')

const I18N_NEW_KEYS = [
  'newProjectInWorkspace',
  'newProjectInWorkspaceHint',
  'newProjectInWorkspaceDescription',
  'projectNameLabel',
  'projectNamePlaceholder',
  'createProjectHint',
  'createProjectReady',
  'creatingProject',
  'createProjectAction',
  'projectNameInvalid',
  'projectNameTooLong',
  'projectFolderExists',
  'useExistingProject',
] as const

describe('create project in default workspace', () => {
  it('exposes POST /api/project/create as a non-local-only action', () => {
    expect(projectRouteSource).toContain("url.pathname === '/api/project/create'")
    const externalActionBlock = projectRouteSource.slice(
      projectRouteSource.indexOf('const externalAction'),
      projectRouteSource.indexOf('if (externalAction)'),
    )
    expect(externalActionBlock).not.toContain('/api/project/create')
  })

  it('creates the directory through project-config, not the filesystem route', () => {
    expect(projectConfigSource).toContain('export async function createProjectInDefaultWorkspace')
    expect(projectConfigSource).toMatch(/fs\.mkdir\(target, \{ recursive: false \}\)/)
    expect(projectConfigSource).toContain('PROJECT_FOLDER_EXISTS')
    expect(projectConfigSource).toContain('INVALID_PROJECT_NAME')
  })

  it('hooks the create call and reuses the existing project list cache invalidation', () => {
    expect(projectHookSource).toContain("fetch('/api/project/create'")
    const start = projectHookSource.indexOf('const createProjectInWorkspace')
    expect(start).toBeGreaterThan(0)
    const body = projectHookSource.slice(start, projectHookSource.indexOf('const toggleProjectExpanded'))
    expect(body).toContain('invalidateApiCache(PROJECT_LIST_CACHE_KEY)')
    expect(body).toContain('setActiveProject(payload.project)')
    expect(body).toContain('setSelectingProject(false)')
  })

  it('passes the create handler and workspace path down to the picker', () => {
    expect(appSource).toContain('onCreateProject={remoteClient ? undefined : handleCreateEmptyStateProject}')
    expect(appSource).toContain('workspacePath={defaultWorkspace?.path}')
  })

  it('switches the popover into a create view with a back action', () => {
    expect(pickerSource).toContain("const [view, setView] = useState<'list' | 'create'>('list')")
    expect(pickerSource).toContain('quickforge-project-create')
    expect(pickerSource).toContain('t(\'newProjectInWorkspace\')')
    expect(pickerSource).toContain("t('createProjectAction')")
    expect(pickerSource).toContain("t('creatingProject')")
    expect(pickerSource).toMatch(/event\.key === 'Enter'[\s\S]{0,140}void handleCreateProject\(\)/)
  })

  it('keeps the create entry out of the popover when no handler is supplied', () => {
    expect(pickerSource).toMatch(/\{onCreateProject \? \(/)
  })

  it('validates names client-side with the same rules as the server', () => {
    expect(pickerSource).toContain('const PROJECT_NAME_INVALID_CHARS = /[\\\\/:*?"<>|]/')
    expect(pickerSource).toContain('PROJECT_NAME_MAX_LENGTH = 64')
    expect(pickerSource).toContain("t('projectFolderExists')")
    expect(pickerSource).toContain('hasControlCharacter')
  })

  it('adds the create-project i18n keys to both language blocks', () => {
    const zhBlockStart = i18nSource.indexOf('  zh: {')
    expect(zhBlockStart).toBeGreaterThan(0)
    const enBlock = i18nSource.slice(0, zhBlockStart)
    const zhBlock = i18nSource.slice(zhBlockStart)
    for (const key of I18N_NEW_KEYS) {
      expect(enBlock).toContain(`    ${key}:`)
      expect(zhBlock).toContain(`    ${key}:`)
    }
  })

  it('styles the create panel without heavy cards or new shadows', () => {
    const createRules = emptyStateCss.slice(emptyStateCss.indexOf('.quickforge-project-create {'))
    expect(createRules).toContain('.quickforge-project-create-submit')
    expect(createRules).toContain('.quickforge-project-create-message-error')
    // Only the input keeps a tiny focus shadow; the panel itself must stay flat.
    const panelRule = emptyStateCss.match(/\.quickforge-project-create \{([^}]*)\}/)?.[1] ?? ''
    expect(panelRule).not.toContain('box-shadow')
    expect(panelRule).not.toContain('border')
  })

  it('drops the always-on emphasis background from the select-directory row', () => {
    const selectRow = pickerSource.slice(
      pickerSource.indexOf('onClick={handleSelectDirectory}'),
      pickerSource.indexOf('{onCreateProject ? ('),
    )
    expect(selectRow).not.toContain('quickforge-project-picker-item-emphasis')
  })
})
