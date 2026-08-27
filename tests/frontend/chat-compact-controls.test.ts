import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')
const hostSource = readFileSync(new URL('../../src/components/chat/ChatPanelHost.tsx', import.meta.url), 'utf8')

// 剥掉注释，避免规则前的中文注释被朴素的选择器匹配正则吸入 selector 文本
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

const compactPrefix = '.quickforge-chat-panel-host.quickforge-chat-compact .quickforge-composer'

describe('chat area compact controls (narrow chat host)', () => {
  describe('ChatPanelHost source contract', () => {
    it('declares the 640 entry threshold and 672 release threshold with hysteresis', () => {
      expect(hostSource).toContain('const CHAT_COMPACT_WIDTH_THRESHOLD = 640')
      expect(hostSource).toContain('const CHAT_COMPACT_WIDTH_RELEASE = 672')
    })

    it('watches the host with ResizeObserver behind a defensive typeof check', () => {
      expect(hostSource).toContain("typeof ResizeObserver === 'undefined'")
      expect(hostSource).toMatch(/const observer = new ResizeObserver/)
      expect(hostSource).toMatch(/observer\.observe\(host\)/)
      expect(hostSource).toMatch(/return \(\) => observer\.disconnect\(\)/)
    })

    it('toggles quickforge-chat-compact using threshold for add and release for remove', () => {
      expect(hostSource).toMatch(
        /if \(width > 0 && width < CHAT_COMPACT_WIDTH_THRESHOLD\) host\.classList\.add\('quickforge-chat-compact'\)/,
      )
      expect(hostSource).toMatch(
        /else if \(width >= CHAT_COMPACT_WIDTH_RELEASE\) host\.classList\.remove\('quickforge-chat-compact'\)/,
      )
    })
  })

  describe('index.css compact section', () => {
    it('shrinks agent-access to 2rem and hides its label and chevron', () => {
      const shrink = ruleFor(`${compactPrefix} .quickforge-agent-access-inline`)
      expect(shrink.body).toMatch(/width:\s*2rem/)
      expect(shrink.body).toMatch(/gap:\s*0/)
      expect(shrink.body).toMatch(/padding-inline:\s*0\s*!important/)

      // :is() 参数表内的逗号会让朴素的选择器 split 失配，改用精确规则文本断言
      expect(cssRules).toContain(
        `${compactPrefix} .quickforge-agent-access-inline :is(.quickforge-agent-access-label, .quickforge-agent-access-chevron) {\n  display: none;\n}`,
      )
    })

    it('shrinks model trigger to 2rem, sr-only its label and hide the thinking-level badge', () => {
      const shrink = ruleFor(`${compactPrefix} .quickforge-model-trigger`)
      expect(shrink.body).toMatch(/width:\s*2rem/)
      expect(shrink.body).toMatch(/min-width:\s*2rem/)
      expect(shrink.body).toMatch(/padding-inline:\s*0\s*!important/)

      const srOnly = ruleFor(`${compactPrefix} .quickforge-model-trigger > span.ml-1`)
      expect(srOnly.body).toMatch(/position:\s*absolute/)
      expect(srOnly.body).toMatch(/width:\s*1px/)
      expect(srOnly.body).toMatch(/height:\s*1px/)
      expect(srOnly.body).toMatch(/margin:\s*-1px\s*!important/)
      expect(srOnly.body).toMatch(/clip:\s*rect\(0 0 0 0\)/)

      const badge = ruleFor(`${compactPrefix} .quickforge-model-trigger[data-quickforge-thinking-level]::after`)
      expect(badge.body).toMatch(/display:\s*none/)
    })

    it('shrinks the plan button to 2rem and hides its plain text span only', () => {
      const shrink = ruleFor(`${compactPrefix} .quickforge-plan-inline`)
      expect(shrink.body).toMatch(/width:\s*2rem/)
      expect(shrink.body).toMatch(/gap:\s*0/)
      expect(shrink.body).toMatch(/padding-inline:\s*0\s*!important/)

      const hide = ruleFor(`${compactPrefix} .quickforge-plan-inline > span`)
      expect(hide.body).toMatch(/display:\s*none/)
    })

    it('shrinks the opencode config button to 2rem and hides its label and chevron', () => {
      const shrink = ruleFor(`${compactPrefix} .quickforge-opencode-config-inline`)
      expect(shrink.body).toMatch(/width:\s*2rem/)
      expect(shrink.body).toMatch(/gap:\s*0/)
      expect(shrink.body).toMatch(/padding-inline:\s*0\s*!important/)

      // :is() 参数表内的逗号会让朴素的选择器 split 失配，改用精确规则文本断言
      expect(cssRules).toContain(
        `${compactPrefix} .quickforge-opencode-config-inline :is(.quickforge-opencode-config-label, .quickforge-agent-access-chevron) {\n  display: none;\n}`,
      )
    })

    it('shrinks the opencode mode button to 2rem and hides its label', () => {
      const shrink = ruleFor(`${compactPrefix} .quickforge-opencode-mode-inline`)
      expect(shrink.body).toMatch(/width:\s*2rem/)
      expect(shrink.body).toMatch(/min-width:\s*2rem/)
      expect(shrink.body).toMatch(/padding-inline:\s*0\s*!important/)

      const hide = ruleFor(`${compactPrefix} .quickforge-opencode-mode-inline .quickforge-opencode-mode-label`)
      expect(hide.body).toMatch(/display:\s*none/)
    })
  })

  describe('mobile media block regression guard', () => {
    it('keeps the original @media (max-width: 768px) icon-only rules untouched', () => {
      const mobileStart = css.indexOf('@media (max-width: 768px)')
      expect(mobileStart).toBeGreaterThanOrEqual(0)
      const mobileBlock = css.slice(mobileStart)

      expect(mobileBlock).toContain(
        '  .quickforge-composer .quickforge-agent-access-inline {\n    width: 2rem;\n    gap: 0;\n    padding-inline: 0 !important;\n  }',
      )
      expect(mobileBlock).toContain(
        '  .quickforge-composer .quickforge-agent-access-inline :is(.quickforge-agent-access-label, .quickforge-agent-access-chevron) {\n    display: none;\n  }',
      )
      expect(mobileBlock).toContain(
        '  .quickforge-composer .quickforge-model-trigger {\n    width: 2rem;\n    min-width: 2rem;\n    gap: 0;\n    padding-inline: 0 !important;\n  }',
      )
      expect(mobileBlock).toContain(
        '  .quickforge-composer .quickforge-model-trigger[data-quickforge-thinking-level]::after {\n    display: none;\n  }',
      )
    })
  })
})
