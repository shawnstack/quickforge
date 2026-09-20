import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// 工具卡状态文案由纯函数 toolOutputText 生成；display settings 只在该渲染路径上读取。
vi.mock('@/lib/tool-display-settings', () => ({ getCachedToolDisplaySettings: () => ({ toolDisplayMode: 'concise' }) }))

import { appTranslations, applyAppLanguageFromSnapshot } from '../../src/lib/i18n'
import { toolOutputText } from '../../src/lib/tool-renderers/shared'

const localFilePathSource = readFileSync(
  new URL('../../src/components/chat/panel-decoration/local-file-path-links.ts', import.meta.url),
  'utf8',
)
const contextUsageSource = readFileSync(
  new URL('../../src/components/chat/context-usage.ts', import.meta.url),
  'utf8',
)

// 文案来源固定语言：默认回退 navigator.language（中文机器上即 zh）。
beforeEach(() => applyAppLanguageFromSnapshot('en'))

describe('decorator copy goes through i18n', () => {
  it('translates the local file path link aria-label and keeps the path as title', () => {
    expect(localFilePathSource).toContain("t('openLocalFileWithPath', { path: pathValue })")
    expect(localFilePathSource).toContain('button.title = pathValue')
    expect(localFilePathSource).not.toContain("'Open file'")
    expect(localFilePathSource).not.toContain('`Open file ${pathValue}`')
  })

  it('translates the git branch label', () => {
    expect(contextUsageSource).toContain("t('gitBranchLabel', { branch: gitBranch })")
    expect(contextUsageSource).not.toContain('`Git branch: ${gitBranch}`')
  })
})

describe('run_command synthetic status copy', () => {
  const runningResult = () => toolOutputText('run_command', { command: 'npm test' }, { details: { command: 'npm test', running: true } })

  it('renders running/exit status in English', () => {
    expect(runningResult()).toContain('Status: running')
    expect(toolOutputText('run_command', { command: 'npm test' }, { details: { command: 'npm test', code: 1 } }))
      .toContain('Exit code: 1')
  })

  it('renders running/exit status in Chinese', () => {
    applyAppLanguageFromSnapshot('zh')

    expect(runningResult()).toContain('状态：运行中')

    const exit = toolOutputText('run_command', { command: 'npm test' }, { details: { command: 'npm test', code: 2, timedOut: true } })
    expect(exit).toContain('退出码：2')
    expect(exit).toContain('已超时')
  })

  it('localizes the command/stdout/stderr labels in English', () => {
    const output = toolOutputText('run_command', { command: 'npm test' }, { details: { command: 'npm test', stdout: 'ok', code: 0 } })
    expect(output).toContain('Command: npm test')
    expect(output).toContain('STDOUT:')
    expect(output).toContain('ok')
    expect(output).toContain('STDERR:')
    expect(output).toContain('(empty)')
  })

  it('localizes the command/stdout/stderr labels in Chinese', () => {
    applyAppLanguageFromSnapshot('zh')

    const output = toolOutputText('run_command', { command: 'npm test' }, { details: { command: 'npm test', stdout: 'ok', code: 0 } })
    expect(output).toContain('命令：npm test')
    expect(output).toContain('标准输出：')
    expect(output).toContain('标准错误：')
    expect(output).toContain('（空）')
  })
})

describe('app translations stay aligned', () => {
  it('keeps identical key sets in en and zh', () => {
    expect(Object.keys(appTranslations.zh).sort()).toEqual(Object.keys(appTranslations.en).sort())
  })
})
