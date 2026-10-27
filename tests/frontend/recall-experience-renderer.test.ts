import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { appCss } from '../helpers/app-css'

// 显示模式按用例切换（渲染器经 tool-renderers/shared 的 toolDisplayDetailed 读取）。
const toolDisplay = vi.hoisted(() => ({ mode: 'default' as 'default' | 'detailed' }))
vi.mock('@/lib/tool-display-settings', () => ({
  getCachedToolDisplaySettings: () => ({ toolDisplayMode: toolDisplay.mode }),
}))

import { buildRecallExperienceViewModel, recallRecencyDays } from '../../src/lib/recall-experience-history'
import { applyAppLanguageFromSnapshot, t } from '../../src/lib/i18n'
import { RecallExperienceToolRenderer } from '../../src/lib/tool-renderers/recall-experience-tool-renderer'
import { summarizeParams } from '../../src/lib/tool-param-summary'

const localToolsSource = readFileSync(new URL('../../src/lib/local-tools.ts', import.meta.url), 'utf8')
const source = readFileSync(new URL('../../src/lib/tool-renderers/recall-experience-tool-renderer.tsx', import.meta.url), 'utf8')
const shared = readFileSync(new URL('../../src/lib/tool-renderers/shared.tsx', import.meta.url), 'utf8')
const i18n = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')
const css = appCss

const memory = (overrides: Record<string, unknown> = {}) => ({
  id: 'mem-1',
  kind: 'preference',
  scope: 'project',
  content: 'Run the full test/lint/build gate before any release.',
  confidence: 0.86,
  strength: 4.2,
  recallCount: 2,
  evidence: [{ sessionId: 's1', seq: 1, note: '' }, { sessionId: 's2', seq: 2, note: '' }, { sessionId: 's1', seq: 3, note: '' }],
  updatedAt: Date.now(),
  ...overrides,
})

const result = (memories: unknown[], query = 'release') => ({
  details: { type: 'recall_experience_result', query, count: memories.length, memories },
  content: [{ type: 'text', text: 'Recalled 1 experience entry.' }],
})

applyAppLanguageFromSnapshot('en')

function render(params: unknown, output: unknown, streaming = false, detailed = false) {
  toolDisplay.mode = detailed ? 'detailed' : 'default'
  const rendered = new RecallExperienceToolRenderer()
    .render(params as Record<string, unknown> | undefined, output as Parameters<RecallExperienceToolRenderer['render']>[1], streaming)
  return { rendered, markup: renderToStaticMarkup(rendered.content as ReactElement) }
}

describe('recall_experience view model', () => {
  it('reads memories from result details and derives a deduped session count', () => {
    const view = buildRecallExperienceViewModel(result([memory()]))
    expect(view.available).toBe(true)
    expect(view.query).toBe('release')
    expect(view.memories).toHaveLength(1)
    expect(view.memories[0]).toMatchObject({
      id: 'mem-1',
      kind: 'preference',
      scope: 'project',
      content: 'Run the full test/lint/build gate before any release.',
      confidence: 0.86,
      strength: 4.2,
      recallCount: 2,
      sessionCount: 2,
    })
  })

  it('never invents a list for missing or foreign details', () => {
    for (const output of [undefined, {}, { details: null }, { details: { type: 'other', memories: [memory()] } }]) {
      expect(buildRecallExperienceViewModel(output as { details?: unknown } | undefined))
        .toEqual({ available: false, query: '', memories: [] })
    }
  })

  it('drops unusable rows and normalizes out-of-range fields instead of rendering junk', () => {
    const view = buildRecallExperienceViewModel(result([
      null,
      'bad',
      {},
      memory({ id: '', content: '   ' }),
      memory({ kind: 'bogus', scope: 'bogus', confidence: 4, strength: -1, recallCount: -3, evidence: null, updatedAt: 0 }),
    ]))
    expect(view.memories).toHaveLength(1)
    // 空正文的行整条丢弃；剩下的行保留自己的 id，越界字段收敛到合法区间。
    expect(view.memories[0]).toMatchObject({ id: 'mem-1', kind: 'experience', scope: 'global', confidence: 1, strength: 0, recallCount: 0, sessionCount: 0, updatedAt: null })
  })

  it('treats future timestamps as fresh rather than negative ages', () => {
    expect(recallRecencyDays(null)).toBeNull()
    expect(recallRecencyDays(Date.now() + 86_400_000)).toBe(0)
    expect(recallRecencyDays(Date.now() - 3 * 86_400_000)).toBe(3)
  })
})

describe('recall_experience registered renderer', () => {
  it('registers a custom renderer on the shared shell, collapsed by default', () => {
    expect(localToolsSource).toContain("registerToolRenderer('recall_experience', new RecallExperienceToolRenderer())")
    const view = render({ query: 'release' }, result([memory()]))
    expect(view.rendered.isCustom).toBe(true)
    expect(view.markup).toContain('quickforge-local-tool-shell')
    expect(view.markup).toContain('quickforge-tool-summary')
    expect(view.markup).toContain('<details class="group/tool quickforge-local-tool quickforge-recall-tool"')
    expect(view.markup).not.toContain('open=')
    expect(view.markup).toContain('quickforge-recall-list')
    expect(view.markup).toContain('quickforge-recall-item')
    expect(view.markup).toContain(t('recallExperience'))
    expect(view.markup).toContain('release')
    // 不使用设置页的 badge 体系：经验条目是聊天内容，不是设置项。
    expect(view.markup).not.toContain('data-tone=')
  })

  it('shows kind, scope, recall count, content and quality metrics per entry', () => {
    const view = render({ query: 'release' }, result([memory()]))
    expect(view.markup).toContain('quickforge-recall-kind')
    expect(view.markup).toContain(t('dreamingKindPreference'))
    expect(view.markup).toContain(t('dreamingScopeProject'))
    expect(view.markup).toContain('×2')
    expect(view.markup).toContain('Run the full test/lint/build gate before any release.')
    expect(view.markup).toContain('quickforge-recall-metrics')
    expect(view.markup).toContain('0.86')
    expect(view.markup).toContain('4.2')
    expect(view.markup).toContain(t('recallExperienceSessions', { count: 2 }))
    expect(view.markup).toContain(t('recallExperienceUpdatedToday'))
  })

  it('treats zero hits as a normal result, not an error', () => {
    const view = render({ query: 'release' }, result([], 'release'))
    expect(view.markup).toContain('quickforge-recall-empty')
    // 静态渲染会把文本里的双引号转义成 &quot;，断言时对齐同一形态。
    expect(view.markup).toContain(t('recallExperienceEmptyMatch', { query: 'release' }).replaceAll('"', '&quot;'))
    expect(view.markup).toContain(t('recallExperienceNoMatch'))
    // 计数常显（meta-important），因为 0 命中就是这次调用的结论。
    expect(view.markup).toContain('quickforge-tool-meta-important')
    // 成功不渲染状态图标（与其余工具一致）：零命中不得显示错误态。
    expect(view.markup).not.toContain(`aria-label="${t('error')}"`)
    expect(view.markup).not.toContain('quickforge-recall-list')
    expect(view.markup).not.toContain('qf-console-block')
  })

  it('only uses the error surface when the call itself failed', () => {
    const view = render({ query: 'release' }, {
      isError: true,
      details: { type: 'recall_experience_result', query: 'release', count: 0, memories: [] },
      content: [{ type: 'text', text: 'Experience store unavailable.' }],
    })
    expect(view.markup).toContain('qf-console-block')
    expect(view.markup).toContain('Experience store unavailable.')
    expect(view.markup).toContain(`aria-label="${t('error')}"`)
    // 失败时不追加「没有匹配」的说明，避免两个矛盾结论并存。
    expect(view.markup).not.toContain('quickforge-recall-empty')
  })

  it('hides successful-hit counts until hover and streams only while running', () => {
    const view = render({ query: 'release' }, result([memory()]))
    expect(view.markup).toContain('quickforge-tool-meta-hover')
    expect(view.markup).toContain(t('recallExperienceHitCount', { count: 1 }))

    const streaming = render({ query: 'release' }, undefined, true)
    expect(streaming.markup).toContain('quickforge-tool-running-sweep')
    expect(streaming.markup).not.toContain('quickforge-recall-count')
    expect(streaming.markup).toContain('aria-busy="true"')
  })

  it('falls back to the strongest-memory wording without a query', () => {
    expect(render(undefined, result([memory()], '')).markup).toContain(t('recallExperienceBest'))
  })

  it('keeps raw JSON in detailed mode only and renders no interactive controls', () => {
    // 默认模式不带任何按钮；detailed 模式下的按钮全部来自代码块的复制动作。
    expect(render({ query: 'release' }, result([memory()])).markup).not.toContain('<button')
    const view = render({ query: 'release' }, result([memory()]), false, true)
    expect(view.markup.match(/class="qf-code-block\b/g) ?? []).toHaveLength(2)
    expect(view.markup).toContain('recall_experience_result')
    const buttons = view.markup.match(/<button[^>]*data-qf-action="[^"]*"/g) ?? []
    expect(buttons.length).toBe(view.markup.match(/<button/g)?.length ?? 0)
    expect(source).not.toMatch(/innerHTML|unsafeHTML|onClick|dispatchEvent/)
  })

  it('has a dedicated type icon instead of the wrench fallback', () => {
    expect(shared).toContain("if (toolName === 'recall_experience') return")
    expect(render({ query: 'release' }, result([memory()])).markup).toContain('quickforge-tool-type-icon')
  })

  it('contributes the query to the shared param summary used by subagent rows', () => {
    expect(summarizeParams('recall_experience', { query: '  release  ' })).toBe('release')
    expect(summarizeParams('recall_experience', {})).toBe('')
  })
})

describe('recall_experience styles', () => {
  it('reuses the flat history-row recipe and message font scale', () => {
    expect(css).toMatch(/\.quickforge-recall-list\s*\{[\s\S]*?list-style:\s*none;/)
    expect(css).toMatch(/\.quickforge-recall-item\s*\{[\s\S]*?border-radius:\s*0\.375rem;/)
    const itemBody = css.match(/\n\.quickforge-recall-item\s*\{[^}]*\}/)?.[0] ?? ''
    const hoverBody = css.match(/\.quickforge-recall-item:hover\s*\{[^}]*\}/)?.[0] ?? ''
    expect(hoverBody).toContain('background:')
    expect(itemBody + hoverBody).not.toMatch(/box-shadow|\bborder:|\btransform:/)
    expect(css).toMatch(/\.quickforge-recall-content\s*\{[\s\S]*?calc\(var\(--quickforge-message-font-size, 14px\) \* 0\.875\)/)
    expect(css).toMatch(/\.quickforge-recall-tool > div \.text-xs\s*\{[\s\S]*?calc\(var\(--quickforge-message-font-size, 14px\) \* 0\.8\)/)
  })

  it('keeps every color on semantic tokens so dark mode needs no override', () => {
    const block = css.slice(css.indexOf('.quickforge-recall-list'), css.indexOf('.quickforge-recall-count'))
    expect(block).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/)
    expect(block).not.toMatch(/border-border\/\d|bg-muted\/\d/)
    expect(block).toContain('var(--muted-foreground)')
  })
})

describe('recall_experience copy', () => {
  it('ships every key in both languages', () => {
    for (const key of [
      'recallExperience',
      'recallExperienceBest',
      'recallExperienceHitCount',
      'recallExperienceNoMatch',
      'recallExperienceEmptyMatch',
      'recallExperienceEmptyAll',
      'recallExperienceSessions',
      'recallExperienceUpdatedToday',
      'recallExperienceUpdatedDays',
    ]) {
      expect(i18n.match(new RegExp(`\\b${key}:`, 'g'))?.length).toBe(2)
    }
    expect(i18n).toContain("recallExperience: 'Recalled experience'")
    expect(i18n).toContain("recallExperience: '回忆经验'")
    expect(i18n).toContain("recallExperienceHitCount: '命中 {count} 条'")
  })
})
