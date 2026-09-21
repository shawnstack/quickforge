import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AssistantMessage } from '../../src/components/chat/surface/AssistantMessage'
import { ThinkingBlock } from '../../src/components/chat/surface/ThinkingBlock'
import { ToolMessage } from '../../src/components/chat/surface/ToolMessage'
import { UsageBar } from '../../src/components/chat/surface/UsageBar'
import { UserMessage } from '../../src/components/chat/surface/UserMessage'
import type {
  AssistantMessage as AssistantMessageType,
  ToolCall,
  Usage,
} from '../../src/components/chat/surface/ChatTypes'
import { getLocalWorkspaceTools } from '../../src/lib/local-tools'

/**
 * CSS ⇄ DOM 结构契约（T5 迁移后的结构回归）。
 *
 * `src/index.css` 里按「消息根的直接子级」书写的规则（每条消息的用量行隐藏、
 * 用户气泡靠右）只有在 React 组件渲染出同样层级时才生效；旧 DOM 的层级选择器
 * 不会报错，只会静默失效。这里对同一份契约同时断言 CSS 与真实渲染结构。
 */

const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')

function usage(): Usage {
  return {
    input: 10,
    output: 20,
    cacheRead: 100,
    cacheWrite: 5,
    totalTokens: 135,
    cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
  }
}

function assistantMessage(overrides: Partial<AssistantMessageType> = {}): AssistantMessageType {
  return {
    role: 'assistant',
    content: [],
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-test',
    usage: usage(),
    stopReason: 'stop',
    timestamp: 1,
    ...overrides,
  }
}

describe('per-message usage line contract', () => {
  it('renders the usage line as a direct child of div.qf-assistant-message', () => {
    // 无正文时根的直接子级只有用量行：`根 > 用量元素` 两级结构。
    const markup = renderToStaticMarkup(createElement(AssistantMessage, { message: assistantMessage() }))

    expect(markup).toMatch(/^<div class="qf-assistant-message"><div class="qf-usage-line [^>]*>[^<]*<\/div><\/div>$/)
    expect(markup).toContain('↑10 ↓20 R100 W5 $0.0030')
  })

  it('keeps the usage line a direct sibling of the content container', () => {
    const markup = renderToStaticMarkup(
      createElement(AssistantMessage, {
        message: assistantMessage({ content: [{ type: 'text', text: 'assistant body' }] }),
      }),
    )

    // 正文容器与用量行是同一个父级（根）的相邻兄弟，而不是父子。
    // gap-1.5 对齐过程组内 0.375rem 的节奏（R9 回归修复）。
    expect(markup).toContain('<div class="qf-assistant-message"><div class="flex flex-col gap-1.5 px-4">')
    expect(markup).toMatch(/<\/div><div class="qf-usage-line [^>]*>↑10 ↓20 R100 W5 \$0\.0030<\/div><\/div>$/)
  })

  it('hides the usage line with a selector that matches that DOM shape', () => {
    expect(css).toMatch(/\.qf-assistant-message > \.qf-usage-line,[\s\S]*?\{\s*display: none !important;/)
    // subagent 过程列表复用同一套消息组件，需要同样的隐藏分支（后代形式容忍包裹层级）。
    expect(css).toMatch(
      /\[data-quickforge-subagent-process="true"\] \.qf-assistant-message \.qf-usage-line,/,
    )
    // 旧 DOM（根 > div > 用量元素 / message-list + assistant-message 标签）选择器
    // 对现 DOM 静默失效，不得回流。
    expect(css).not.toContain('> div > .px-4.mt-2.text-xs.text-muted-foreground')
    expect(css).not.toMatch(/message-list\s+assistant-message/)
  })

  it('keeps hiding only the token/cost spans of the composer stats row', () => {
    // 汇总行 = 装饰层挂 `quickforge-composer` 的 .qf-message-editor 紧随的 `.qf-usage-bar`；
    // context usage / git 分支徽标（context-usage.ts 同一个 .ml-auto.items-center 容器内）保持可见。
    expect(css).toMatch(
      /\.quickforge-composer \+ \.qf-usage-bar[\s\S]{0,160}?:is\(span, button\):not\(\.quickforge-context-usage\):not\(\.quickforge-context-usage-label\):not\(\.quickforge-git-branch-inline\)/,
    )
    expect(css).not.toContain('.quickforge-composer + .text-xs.text-muted-foreground.flex.justify-between.items-center.h-5')
  })

  it('covers the onCostClick button variant of the stats row totals', () => {
    // 宿主传 onCostClick 时 totals 渲染为 button 而非 span；隐藏选择器用
    // :is(span, button) 同时命中两种形态（:not 豁免语义不变）。
    const markup = renderToStaticMarkup(
      createElement(UsageBar, { messages: [assistantMessage()], onCostClick: () => { } }),
    )
    expect(markup).toContain('<button type="button" class="cursor-pointer transition-colors hover:text-foreground">')
    expect(css).not.toMatch(/\.ml-auto\.items-center\s*>\s*span:not\(/)
  })
})

describe('user message bubble alignment contract', () => {
  it('renders the bubble as a direct child of the flex root', () => {
    const markup = renderToStaticMarkup(
      createElement(UserMessage, { message: { role: 'user', content: 'hello', timestamp: 1 } }),
    )

    // 行容器（flex justify-start）就是消息根，气泡容器是它的直接子级。
    expect(markup).toContain('<div class="qf-user-message flex justify-start mx-4"><div class="user-message-container ')
  })

  it('right-aligns the bubble from the current DOM shape', () => {
    expect(css).toMatch(/\.qf-user-message > \.user-message-container \{\s*order: 1;\s*align-self: flex-end;\s*\}/)
    // 旧 DOM 的内层行容器选择器不得回流（否则右对齐再次静默失效）。
    expect(css).not.toContain('.quickforge-user-message > div.flex.justify-start')
  })

  it('keeps the existing max-width ceiling for the bubble', () => {
    // 右对齐只改主轴位置与收缩，不放大宽度上限。
    const bubbleRule = css.match(/\.qf-user-message \.user-message-container,[\s\S]*?\n\}/)?.[0] ?? ''
    expect(bubbleRule).toContain('max-width: min(78%, 45rem) !important')
    expect(css).toMatch(/@media \(width < 48rem\) \{\s*\.quickforge-user-message \.user-message-container,\s*\.qf-user-message \.user-message-container \{\s*max-width: min\(86%, 45rem\) !important;/)
  })

  it('keeps the user action row ordered after the bubble', () => {
    expect(css).toMatch(/\.quickforge-user-message > \.quickforge-message-actions \{\s*order: 2;\s*align-self: flex-end;\s*\}/)
  })
})

describe('chat markdown typography contract', () => {
  it('restores heading and paragraph rules that Tailwind preflight would collapse', () => {
    expect(css).toMatch(/\.qf-markdown-block :where\(h1, h2, h3, h4, h5, h6\) \{\s*font-weight:/)
    expect(css).toMatch(/\.qf-markdown-block h1 \{[\s\S]*?font-size:/)
    expect(css).toContain('.qf-markdown-block p {')
  })

  it('styles markdown links and tables from scoped CSS instead of utility classes', () => {
    expect(css).toContain('.qf-markdown-block a:hover')
    expect(css).toMatch(/\.qf-markdown-block a:hover \{[\s\S]*?color-mix\(in oklab, var\(--primary\) 80%, transparent\)/)
    expect(css).toContain('.qf-markdown-block table')
    expect(css).toMatch(/\.qf-markdown-block table \{[\s\S]*?border-collapse: collapse;/)
  })

  it('keeps the markdown link hover guarded by hover-capable media with a color-mix fallback', () => {
    // 对齐旧 `.markdown-content a:hover` 的结构：外层 @media(hover:hover) 避免
    // 触屏（hover:none）设备点击后残留粘滞变色；内部先回退 var(--primary)，
    // 支持 color-mix 的浏览器再经 @supports 渐进增强为 80% 透明度。
    expect(css).toMatch(
      /@media \(hover: hover\) \{\s*\.qf-markdown-block a:hover \{\s*color: var\(--primary\);\s*\}\s*@supports \(color: color-mix\(in lab, red, red\)\) \{\s*\.qf-markdown-block a:hover \{\s*color: color-mix\(in oklab, var\(--primary\) 80%, transparent\);\s*\}\s*\}/,
    )
    // 脱离 hover 媒体查询的裸规则（触屏会粘滞变色）不得回归。
    expect(css).not.toMatch(/\n\.qf-markdown-block a:hover \{/)
  })

  it('keeps the inline code line-height aligned with the legacy markdown rule', () => {
    // 行内 code 的字号/行高对齐旧 `.markdown-content code:not(.hljs)` 的取值
    // （text-sm + --text-sm--line-height），迁移后不得丢失行高。
    expect(css).toMatch(
      /\.qf-markdown-block :not\(pre\) > code \{[\s\S]*?font-size: var\(--text-sm, 0\.875rem\);\s*line-height: var\(--text-sm--line-height\);/,
    )
  })

  it('applies message font-size without depending on decoration-only classes', () => {
    const fontSizeRule = css.match(
      /\.quickforge-assistant-message \.qf-markdown-block,[\s\S]*?font-size: var\(--quickforge-message-font-size, 14px\);/,
    )?.[0] ?? ''
    expect(fontSizeRule).toContain('.qf-assistant-message .qf-markdown-block')
    expect(fontSizeRule).toContain('.qf-user-message .qf-markdown-block')
  })
})

describe('tool row flattening contract', () => {
  const toolCall = (name: string): ToolCall => ({ type: 'toolCall', id: `call-${name}`, name, arguments: {} })

  it('renders the MCP tool row flat: no card classes on the qf-tool-message root', () => {
    getLocalWorkspaceTools([
      { name: 'mcp__contract__echo', label: 'Echo', parameters: { type: 'object' }, description: 'MCP tool' },
    ])
    const markup = renderToStaticMarkup(createElement(ToolMessage, { toolCall: toolCall('mcp__contract__echo') }))

    // 旧版把 isCustom 工具卡的卡框（padding/border/radius/bg/shadow）重置清零成扁平行；
    // React 迁移后等价契约是根本身不带头像卡框类。
    expect(markup).toContain('class="qf-tool-message"')
    expect(markup).toContain('quickforge-mcp-tool')
    expect(markup).toContain('quickforge-tool-summary')
    expect(markup).not.toContain('bg-card')
    expect(markup).not.toContain('border-border')
    expect(markup).not.toContain('p-2.5')
    expect(markup).not.toContain('shadow-xs')
  })

  it('renders the subagent run summary flat: no card classes on the qf-tool-message root', () => {
    const markup = renderToStaticMarkup(createElement(ToolMessage, { toolCall: toolCall('run_subagent') }))

    expect(markup).toContain('class="qf-tool-message"')
    expect(markup).toContain('quickforge-subagent-tool')
    expect(markup).toContain('quickforge-tool-summary')
    expect(markup).not.toContain('bg-card')
    expect(markup).not.toContain('border-border')
    expect(markup).not.toContain('p-2.5')
    expect(markup).not.toContain('shadow-xs')
  })

  it('hides the running status icon on the subagent run summary while the run is streaming', () => {
    // 运行中隐藏状态区（icon+耗时，与 local-workspace 渲染器一致）：
    // 运行态由 statusLabel 文案 + 跑马灯表达，摘要卡自身不再出现旋转 spinner。
    const markup = renderToStaticMarkup(createElement(ToolMessage, { toolCall: toolCall('run_subagent'), pending: true }))

    expect(markup).toContain('quickforge-subagent-tool')
    // 运行态文案（statusLabel）仍在标签 span 中表达（语言无关的非空断言）。
    expect(markup).toMatch(/quickforge-subagent-label">[^<]+</)
    expect(markup).not.toContain('quickforge-tool-status-icon')
    expect(markup).not.toContain('animate-spin')
  })

  it('keeps the fallback tool card carded in the panel and flattens it only inside process groups', () => {
    const markup = renderToStaticMarkup(createElement(ToolMessage, { toolCall: toolCall('unknown_tool') }))
    expect(markup).toContain('bg-card')
    expect(markup).toContain('border-border')

    // 卡框在根上：压平重置必须锚定 .qf-tool-message 根（仅过程折叠组内），
    // 旧结构的 `> div:first-child` 选择器对现 DOM 静默失效，不得回流。
    expect(css).toMatch(
      /\.quickforge-process-body \.qf-tool-message \{\s*padding: 0 !important;\s*border: 0 !important;\s*border-radius: 0 !important;\s*background: transparent !important;\s*box-shadow: none !important;\s*color: inherit;\s*\}/,
    )
    expect(css).not.toContain('.qf-tool-message > div:first-child')
  })
})

describe('code highlight palette contract', () => {
  /** 变量在文件里的全部取值，文档顺序即主题顺序（`:root` 亮色在前、`.dark` 在后）。 */
  function oklchValues(name: string): string[] {
    const pattern = new RegExp(`--${name}:\\s*([^;]+);`, 'g')
    // 旧包 CSS 用 `.029` 式简写小数，当前文件写 `0.029`；比较前统一去掉前导零。
    return [...css.matchAll(pattern)].map((match) => (match[1] ?? '').trim().replace(/ 0\./g, ' .'))
  }

  it('keeps the diff fg/bg pair at the pre-removal highlight.js values in both themes', () => {
    // 旧值锁定：移除前 highlight.js 时代的构建产物
    // `package-dist/dist/assets/index-B1G0LqYR.css` 里的
    // `--syntax-addition-*` / `--syntax-deletion-*`（亮色 `:root` 与暗色 `.dark`）。
    const legacyPairs: Array<[string, string, string]> = [
      ['qf-hl-addition-bg', 'oklch(98.4% .029 166.113)', 'oklch(18.8% .06 166.113)'],
      ['qf-hl-addition-fg', 'oklch(40.3% .111 145.348)', 'oklch(87% .147 145.348)'],
      ['qf-hl-deletion-bg', 'oklch(98.1% .025 17.672)', 'oklch(23.3% .129 17.672)'],
      ['qf-hl-deletion-fg', 'oklch(43.1% .183 27.522)', 'oklch(92% .067 17.672)'],
    ]
    for (const [name, light, dark] of legacyPairs) {
      expect(oklchValues(name), name).toEqual([light, dark])
    }
  })

  it('declares both color and background-color on the diff token rules', () => {
    // 旧 `.hljs-addition` / `.hljs-deletion` 都是前景 + 底色成对声明；只留其一
    // 会在亮色或暗色下丢掉可读性。
    for (const token of ['addition', 'deletion'] as const) {
      const rule = css.match(new RegExp(`\\.qf-hl-${token} \\{[^}]*\\}`))?.[0] ?? ''
      expect(rule).toContain(`color: var(--qf-hl-${token}-fg);`)
      expect(rule).toContain(`background-color: var(--qf-hl-${token}-bg);`)
    }
  })

  it('keeps punctuation uncolored: no punct variable and no punct rule', () => {
    // 标点与旧版一致继承正文字色（旧调色板里也没有 `.hljs-punctuation` 规则）。
    expect(css).not.toMatch(/--qf-hl-punct\s*:/)
    expect(css).not.toMatch(/\.qf-hl-punct\s*\{/)
  })

  it('re-declares the legacy heading / list / code / quote values in both themes', () => {
    // 旧 `--syntax-heading` / `--syntax-list` / `--syntax-comment` / `--syntax-tag`。
    const legacy: Array<[string, string, string]> = [
      ['qf-hl-heading', 'oklch(43.5% .141 237.016)', 'oklch(52.3% .181 237.016)'],
      ['qf-hl-list', 'oklch(53.7% .108 88.766)', 'oklch(86.6% .141 88.766)'],
      ['qf-hl-code', 'oklch(54% .019 247.858)', 'oklch(62.6% .025 247.858)'],
      ['qf-hl-quote', 'oklch(40.3% .111 145.348)', 'oklch(81.2% .159 145.348)'],
    ]
    for (const [name, light, dark] of legacy) {
      expect(oklchValues(name), name).toEqual([light, dark])
      expect(css).toMatch(new RegExp(`\\.${name} \\{[^}]*color: var\\(--${name}\\);`))
    }
  })

  it('keeps the legacy glyph effects that never depended on a color variable', () => {
    // 旧 `.hljs-section` 除 `--syntax-heading` 外还声明 font-weight:700；
    // `.hljs-strong`(font-weight:700) / `.hljs-emphasis`(font-style:italic) 只声明
    // 字形（旧 `color: var(--color-text-primary)` 的变量在产物里不存在 → 继承
    // 正文字色），因此新规则同样不得声明颜色变量。
    expect(css).toMatch(/\.qf-hl-heading \{[^}]*font-weight: 700;/)
    expect(css).toMatch(/\.qf-hl-strong \{ font-weight: 700; \}/)
    expect(css).toMatch(/\.qf-hl-emphasis \{ font-style: italic; \}/)
    expect(css).not.toMatch(/--qf-hl-strong\s*:/)
    expect(css).not.toMatch(/--qf-hl-emphasis\s*:/)
  })

  it('keeps the legacy `.hljs-link` contract: no rule, the target inherits the body color', () => {
    expect(css).not.toMatch(/--qf-hl-link\s*:/)
    expect(css).not.toMatch(/\.qf-hl-link\s*\{/)
  })
})

describe('svg/mermaid code block frame contract', () => {
  it('keeps the decorated SVG block frameless like the pre-removal card reset', () => {
    // 旧 src/index.css L2375（pi `<code-block>` 内层卡片）：
    // `position: relative; border: 0 !important; background: transparent !important;
    //  box-shadow: none !important`。React 里该元素本身就是卡片，类名仍在输出
    // （CodeBlock.tsx `supportedPreview && 'quickforge-svg-code-block'`）。
    expect(css).toMatch(
      /\.quickforge-svg-code-block \{\s*position: relative;\s*border: 0 !important;\s*background: transparent !important;\s*box-shadow: none !important;\s*\}/,
    )
    // 旧 L2395：SVG 代码块的标题栏左右内边距为 0。
    expect(css).toMatch(
      /\.quickforge-svg-code-block > div:first-child \{\s*padding-left: 0 !important;\s*padding-right: 0 !important;\s*\}/,
    )
  })

  it('does not resurrect the removed pi-web-ui toolbar classes', () => {
    // 旧 L2382/L2391 的 `quickforge-svg-code-toolbar-floating` 选择器依赖已删除的
    // pi-web-ui 标题栏 DOM（源码 0 处输出该类），补回来只会是死规则。注释里可以
    // 提到该名字（迁移记录），但不得出现选择器。
    expect(css).not.toMatch(/\.quickforge-svg-code-toolbar-floating\s*[,{]/)
    expect(css).not.toMatch(/\.quickforge-svg-code-toolbar-floating\s*>/)
  })
})

describe('thinking header visibility contract', () => {
  it('never hides a raw thinking header: adoption failures must stay visible', () => {
    // 历史 bug（R11/R12）：装饰层「接管思考头」曾因 chevron 识别不到而静默 return，
    // 而面板/过程组级 `display: none` 又把未接管的原生头永久隐藏 —— 默认折叠（只渲染
    // header）的思考块整块消失。fail-visible 契约：不得有任何规则对 .thinking-header 声明
    // display:none（R11 的 `.qf-chat-panel .quickforge-process-body .qf-thinking-block >
    // .thinking-header:not(.quickforge-process-thinking-header)` 尤其不得回流）。
    expect(css).not.toMatch(/\.thinking-header\b[^{}]*\{[^}]*display:\s*none/)
    expect(css).not.toContain('.qf-chat-panel .quickforge-process-body .qf-thinking-block > .thinking-header')
  })

  it('keeps the raw header fallback visible outside process bodies', () => {
    // 兜底规则只改色/hover/chevron（无 display 声明），未接管的原生头保持可见。
    expect(css).toMatch(
      /\n\.qf-thinking-block > \.thinking-header:not\(\.quickforge-process-thinking-header\) \{\s*color: color-mix\(in oklab, var\(--muted-foreground\) 88%, transparent\);\s*transition: color 160ms ease;\s*\}/,
    )
  })

  it('covers the adopted header wherever the decoration layer can place it', () => {
    // 装饰层只在 header 是 .qf-thinking-block 直接子级时接管
    // （`thinkingBlock.querySelector(':scope.qf-thinking-block > .thinking-header')`），
    // 搬入的 thinking 块必然落在 .quickforge-process-body 之内（populateProcessGroup 与
    // populateProcessContainer 把节点 append 进 body / stage-body / tools-body），
    // 因此接管后的可见性规则无需放宽祖先层级——这里同时钉住 CSS 与渲染结构两侧。
    expect(css).toMatch(
      /\.quickforge-process-body \.qf-thinking-block > \.quickforge-process-thinking-header \{\s*display: flex;/,
    )
    expect(renderToStaticMarkup(createElement(ThinkingBlock, { content: 'reasoning trace' }))).toMatch(
      /^<div class="qf-thinking-block thinking-block"><button type="button" class="thinking-header [^"]*"/,
    )
  })
})

describe('chat row font scale contract', () => {
  /** 取 selector 起始处到该规则闭合花括号的原文（这些规则的声明块内无嵌套花括号）。 */
  function declarationBlock(selector: string) {
    const start = css.indexOf(selector)
    if (start < 0) return ''
    const end = css.indexOf('}', start)
    return end < 0 ? '' : css.slice(start, end)
  }

  const MESSAGE_FONT_SCALE = 'font-size: calc(var(--quickforge-message-font-size, 14px) * 0.875)'

  it('keeps process summaries on the message font scale instead of the interface rem base', () => {
    for (const selector of [
      '.quickforge-process-summary {',
      '.quickforge-process-stage-summary,',
      '.quickforge-process-tools-summary {',
    ]) {
      const block = declarationBlock(selector)
      expect(block, selector).toContain(MESSAGE_FONT_SCALE)
      expect(block, selector).not.toContain('font-size: 0.875rem')
    }
  })

  it('keeps the adopted thinking row header on the message font scale', () => {
    const block = declarationBlock(
      '.quickforge-process-body .qf-thinking-block > .quickforge-process-thinking-header {',
    )
    expect(block).toContain(MESSAGE_FONT_SCALE)
    expect(block).not.toContain('font-size: 0.875rem')
  })

  it('covers the tool rows whose summary line carries the text-sm escape hatch', () => {
    // 兜底工具卡（DefaultToolCardBody 首行）与 generate_image 首行自带 text-sm（=1rem）而
    // 逃逸到界面字号；必须与其余工具行同处一个规则，取消息字号基准。
    const block = declarationBlock('.quickforge-local-tool > .quickforge-tool-summary,')
    expect(block).toContain('.quickforge-tool-message > .space-y-2 > .quickforge-tool-summary')
    expect(block).toContain(
      '.quickforge-tool-message > .quickforge-generated-image-tool > .quickforge-tool-summary',
    )
    expect(block).toContain(MESSAGE_FONT_SCALE)
  })
})
