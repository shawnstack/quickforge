import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const pickerSource = readFileSync(new URL('../../src/components/project-directory-picker.tsx', import.meta.url), 'utf8')
const i18nSource = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')
const filesystemRouteSource = readFileSync(new URL('../../server/routes/filesystem.mjs', import.meta.url), 'utf8')

const I18N_NEW_KEYS = ['createDirectory', 'newDirectoryNamePlaceholder', 'createDirectoryFailed', 'creatingDirectory'] as const

function submitNewFolderBody() {
  const match = pickerSource.match(/const submitNewFolder = async \(\) => \{[\s\S]*?\n {2}\}/)
  if (!match) throw new Error('missing submitNewFolder implementation')
  return match[0]
}

describe('project directory picker create-directory contract', () => {
  it('imports FolderPlus from lucide-react', () => {
    expect(pickerSource).toMatch(/import \{[^}]*FolderPlus[^}]*\} from 'lucide-react'/)
  })

  it('posts parentPath and name to /api/filesystem/mkdir', () => {
    expect(pickerSource).toContain("fetch('/api/filesystem/mkdir',")
    expect(pickerSource).toMatch(/method: 'POST'/)
    expect(pickerSource).toMatch(/body: JSON\.stringify\(\{ parentPath: currentPath, name \}\)/)
  })

  it('enters the created directory on success', () => {
    const body = submitNewFolderBody()
    expect(body).toMatch(/await loadDirectory\(payload\.path\)/)
    expect(body).toMatch(/setShowNewFolder\(false\)/)
  })

  it('keeps the inline input row after a failed create', () => {
    const body = submitNewFolderBody()
    const catchClause = body.slice(body.indexOf('} catch'))
    expect(catchClause).toContain("t('createDirectoryFailed')")
    expect(catchClause).not.toContain('setShowNewFolder(false)')
  })

  it('shows a dedicated creating label instead of the selecting label', () => {
    expect(pickerSource).toContain("t('creatingDirectory')")
    expect(pickerSource).not.toContain("t('selecting') : t('createDirectory')")
  })

  it('cancels the inline input with Escape and stops propagation', () => {
    expect(pickerSource).toMatch(/event\.key === 'Escape'[\s\S]{0,200}event\.stopPropagation\(\)/)
  })

  it('disables controls while creating a folder', () => {
    const disabledWithCreating = pickerSource.match(/disabled=\{[^}]*creatingFolder[^}]*\}/g) ?? []
    expect(disabledWithCreating.length).toBeGreaterThanOrEqual(5)
  })

  it('adds the create-directory i18n keys to both language blocks', () => {
    const zhBlockStart = i18nSource.indexOf('  zh: {')
    expect(zhBlockStart).toBeGreaterThan(0)
    const enBlock = i18nSource.slice(0, zhBlockStart)
    const zhBlock = i18nSource.slice(zhBlockStart)
    for (const key of I18N_NEW_KEYS) {
      expect(enBlock).toContain(`    ${key}:`)
      expect(zhBlock).toContain(`    ${key}:`)
    }
  })

  it('no longer exposes the QuickForge install directory as a filesystem root', () => {
    expect(filesystemRouteSource).not.toContain("addRoot('QuickForge'")
  })
})
