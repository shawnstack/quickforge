import { describe, expect, it } from 'vitest'
import { appCss } from '../helpers/app-css'

const css = appCss

// 剥掉注释，避免规则前的中文注释被朴素的选择器匹配正则吸入 selector 文本
// （与 tests/frontend/chat-compact-controls.test.ts 的 ruleFor 同一处理）。
const cssRules = css.replace(/\/\*[\s\S]*?\*\//g, '')

function ruleFor(selector: string) {
  for (const match of cssRules.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1]
      .split(',')
      .map((item) => item.trim())
    if (selectors.includes(selector)) return { selectors, body: match[2] }
  }
  throw new Error(`missing CSS rule: ${selector}`)
}

describe('composer control hover feedback', () => {
  it('keeps the global composer hover rule while overriding only the target neutral controls', () => {
    expect(ruleFor('.quickforge-composer button:hover:not(:disabled)').body).toMatch(/transform:\s*translateY\(-1px\)/)

    const neutralHover = ruleFor('.quickforge-composer .quickforge-plus-inline:hover:not(:disabled)')
    // `.quickforge-thinking-inline` 已随「思考等级并入模型弹层滑杆」一起移除
    // （控件本体见 lib/thinking-slider.ts），因此这里只剩 4 个 composer 控件。
    expect(neutralHover.selectors).toEqual([
      '.quickforge-composer .quickforge-plus-inline:hover:not(:disabled)',
      '.quickforge-composer .quickforge-agent-access-inline:hover:not(:disabled)',
      '.quickforge-composer .quickforge-subagent-running-trigger:hover:not(:disabled)',
      '.quickforge-composer .quickforge-model-trigger:hover:not(:disabled)',
    ])
    expect(neutralHover.body).toMatch(/background:\s*var\(--quickforge-sidebar-hover-bg\)\s*!important/)
    expect(neutralHover.body).toMatch(/color:\s*var\(--foreground\)\s*!important/)
    expect(neutralHover.body).toMatch(/transform:\s*none\s*!important/)
  })

  it('keeps the running Subagent trigger hover feedback', () => {
    const triggerHover = ruleFor('.quickforge-composer .quickforge-subagent-running-trigger:hover:not(:disabled)').body

    expect(triggerHover).toMatch(/background:\s*var\(--quickforge-sidebar-hover-bg\)\s*!important/)
    expect(triggerHover).toMatch(/transform:\s*none\s*!important/)
  })

  /**
   * 模型触发按钮的「· 思考等级」后缀要比模型名更浅一档。
   *
   * 用 `color-mix(... var(--muted-foreground) 72%, transparent)` 而不是
   * Tailwind 语义色透明度：DESIGN_LANGUAGE 明确禁止凭感觉造「更浅」
   * （`border-border/75`、`bg-muted/20` 曾导致实际更深）。父级已经是
   * `--muted-foreground`，所以子级必须真的比它弱。
   */
  it('renders the thinking suffix one step lighter than the model name', () => {
    const suffix = ruleFor('.quickforge-model-trigger-thinking')
    expect(suffix.body).toMatch(/color:\s*color-mix\(in oklab,\s*var\(--muted-foreground\)\s+72%,\s*transparent\)/)
    // 不能用 !important 抢过父级的 hover / 展开态重着色。
    expect(suffix.body).not.toMatch(/!important/)
  })

  it('re-lightens the suffix when the trigger is hovered or expanded', () => {
    const suffix = ruleFor(
      '.quickforge-composer .quickforge-model-trigger[aria-expanded="true"] .quickforge-model-trigger-thinking',
    )
    expect(suffix.selectors).toEqual([
      '.quickforge-composer .quickforge-model-trigger[aria-expanded="true"] .quickforge-model-trigger-thinking',
      '.quickforge-composer .quickforge-model-trigger:hover:not(:disabled) .quickforge-model-trigger-thinking',
    ])
    expect(suffix.body).toMatch(/color:\s*color-mix\(in oklab,\s*var\(--foreground\)\s+62%,\s*transparent\)/)
  })

  it('keeps send hover primary and stationary', () => {
    const sendHover = ruleFor('.quickforge-composer .quickforge-send-button:hover:not(:disabled)').body

    expect(sendHover).toMatch(/background:\s*color-mix\(in oklab,\s*var\(--primary\)\s+\d+%,\s*var\(--quickforge-sidebar-hover-bg\)\)\s*!important/)
    expect(sendHover).toMatch(/color:\s*var\(--primary-foreground\)\s*!important/)
    expect(sendHover).toMatch(/transform:\s*none\s*!important/)
  })

  it('keeps the existing stop hover background and removes movement', () => {
    const stopHover = ruleFor('.quickforge-composer .quickforge-stop-button:hover').body

    expect(stopHover).toMatch(/background:\s*color-mix\(in oklab,\s*var\(--foreground\)\s+88%,\s*var\(--background\)\)\s*!important/)
    expect(stopHover).toMatch(/transform:\s*none\s*!important/)
  })
})
