import { describe, expect, it } from 'vitest'
import { getDirectoryIconName, getFileIconName } from '../../src/components/workspace/file-icon-utils'

describe('getFileIconName', () => {
  it.each([
    ['README.md', 'readme'],
    ['package.json', 'nodejs'],
    ['package-lock.json', 'nodejs'],
    ['vite.config.ts', 'vite'],
    ['Dockerfile', 'docker'],
    ['LICENSE', 'license'],
    ['tsconfig.json', 'tsconfig'],
    ['eslint.config.js', 'eslint'],
    ['tailwind.config.ts', 'tailwindcss'],
  ] as const)('maps special file %s to %s', (path, icon) => {
    expect(getFileIconName(path)).toBe(icon)
  })

  it.each([
    ['src/App.tsx', 'react-ts'],
    ['src/App.jsx', 'react'],
    ['src/index.ts', 'typescript'],
    ['src/index.js', 'javascript'],
    ['src/index.d.ts', 'typescript-def'],
    ['tests/app.test.ts', 'test-ts'],
    ['tests/app.spec.jsx', 'test-jsx'],
    ['config.json', 'json'],
    ['notes.md', 'markdown'],
    ['preview.png', 'image'],
    ['diagram.svg', 'svg'],
    ['archive.zip', 'zip'],
    ['report.pdf', 'pdf'],
    ['report.docx', 'word'],
    ['slides.pptx', 'powerpoint'],
    ['unknown.bin', 'document'],
  ] as const)('maps extension for %s to %s', (path, icon) => {
    expect(getFileIconName(path)).toBe(icon)
  })

  it('supports Windows paths and case-insensitive special names', () => {
    expect(getFileIconName('D:\\project\\README.MD')).toBe('readme')
    expect(getFileIconName('D:\\project\\src\\App.TSX')).toBe('react-ts')
  })
})

describe('getDirectoryIconName', () => {
  it.each([
    ['src', 'folder-src'],
    ['components', 'folder-components'],
    ['tests', 'folder-test'],
    ['__tests__', 'folder-test'],
    ['docs', 'folder-docs'],
    ['server', 'folder-server'],
    ['api', 'folder-api'],
    ['assets', 'folder-resource'],
    ['images', 'folder-images'],
    ['public', 'folder-public'],
    ['config', 'folder-config'],
    ['lib', 'folder-lib'],
    ['hooks', 'folder-hook'],
    ['utils', 'folder-utils'],
    ['routes', 'folder-routes'],
    ['scripts', 'folder-scripts'],
    ['styles', 'folder-css'],
    ['feature', 'folder-base'],
  ] as const)('maps directory %s to %s', (name, icon) => {
    expect(getDirectoryIconName(name, false)).toBe(icon)
    expect(getDirectoryIconName(name, true)).toBe(icon)
  })
})
