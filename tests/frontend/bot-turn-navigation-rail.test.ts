import { readFileSync } from 'node:fs'
import { appAssembly } from './helpers/app-source'
import { describe, expect, it } from 'vitest'

/**
 * Bot 模式不显示对话框左侧的轮次导航条（那条可点的刻度）。
 *
 * 这条刻度原本只在「轨迹视图盖住对话」时被隐藏（z-index 问题）。bot 模式下它是纯噪声：
 * bot 的对话是一件事一段，不靠轮次跳转回看，刻度反而和 bot 侧栏的极简布局抢视觉重量。
 *
 * 这里钉两个决定，都是容易在后续改动里被悄悄回退的：
 * 1. bot 模式也置 `hideTurnNavigation`，且 `botMode` 必须参与判断（不是只看 trace）；
 * 2. 用运行时开关（CSS `display:none`），不是结构性 `showTurnNavigation`——
 *    后者在 ChatPanelHost 的 effect 依赖里，切模式会把整个对话面板重建一次，
 *    草稿/滚动位置这些「中间态」就多了一次全靠卸载 flush 兜底的窗口。
 */

const appMain = appAssembly.appMain

describe('bot mode turn-navigation rail', () => {
  it('hides the rail in bot mode as well as in the trace view', () => {
    expect(appMain).toContain("hideTurnNavigation={botMode || conversationView === 'trace'}")
  })

  it('uses the runtime switch instead of the structural one', () => {
    // 结构性开关会重建面板：主聊天页不允许把它作为 JSX 属性传下去（注释里提到名字没关系）。
    expect(appMain).not.toMatch(/showTurnNavigation=\{/)
    // 运行时开关必须真的接到 ChatPanelHost 上，不能被挪到某个包裹层。
    expect(appMain.indexOf('hideTurnNavigation={')).toBeGreaterThan(appMain.indexOf('<ChatPanelHost'))
    // 且只接一次，别在主区里分叉出第二套判断。
    expect(appMain.match(/hideTurnNavigation=\{/g)).toHaveLength(1)
  })

  it('keeps the CSS hiding path that the runtime switch relies on', () => {
    const css = readFileSync(new URL('../../src/styles/chat/messages.css', import.meta.url), 'utf8')
    expect(css).toMatch(/\.quickforge-chat-panel-host\[data-turn-navigation='hidden'\] \.quickforge-turn-navigation \{\s*display: none !important;/)
    // tooltip 挂在 body 上，必须一起藏；否则刻度没了、悬停预览还会冒出来。
    expect(css).toMatch(/body:has\(\.quickforge-chat-panel-host\[data-turn-navigation='hidden'\]\) \.quickforge-turn-navigation-tooltip \{\s*display: none !important;/)
  })

  it('does not suppress the rail outside bot mode and the trace view', () => {
    // 普通对话保留刻度：隐藏条件里不能出现会话级/项目级开关。
    const line = appMain.split('\n').find((text) => text.includes('hideTurnNavigation={'))
    expect(line).toBeDefined()
    expect(line).not.toMatch(/currentSessionId|projectId|readOnly|sideChat/)
  })
})
