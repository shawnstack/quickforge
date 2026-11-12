import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 反馈：「助手形象 会遮挡 goal 命令的执行」。
 *
 * bot 模式输入框上方的吉祥物与 Goal 控制条住在同一块地方：球（size 79，
 * 球径 300/512 ≈ 46px）默认站在编辑器顶上，而条占着编辑器正上方一行
 * （2rem 高 + 0.375rem 下边距 ≈ 38px），球会整球压住条右端的主操作/「⋯」
 * 按钮——既挡视线也截走点击（球本体 pointer-events: auto）。
 *
 * 修法：条占行时球上移 2.375rem 站到条顶，与条零重叠；球顶对消息区的
 * 探出量与无条时完全一致（约 46px，App.tsx 选型注释锁的量）。
 */
const surfaceSource = readFileSync(
  new URL('../../src/components/chat/surface/ChatSurface.tsx', import.meta.url),
  'utf8',
)
const stripSource = readFileSync(
  new URL('../../src/components/chat/surface/GoalControlStrip.tsx', import.meta.url),
  'utf8',
)
const goalCss = readFileSync(
  new URL('../../src/styles/chat/goal-workflow.css', import.meta.url),
  'utf8',
)

describe('goal 控制条不被输入框上方的吉祥物遮挡', () => {
  it('占行判据与 GoalControlStrip 同源：同一个 buildGoalControlStripView', () => {
    // 条渲染与吉祥物让位必须读同一条规则（终态 goal 不渲染条），
    // 各写一份判据必然漂移。
    expect(surfaceSource).toContain('buildGoalControlStripView(goalState)')
    expect(stripSource).toContain('buildGoalControlStripView(goal)')
  })

  it('吉祥物 wrapper 的 top 随占行切换：占行时上移到条顶，无条时回编辑器顶', () => {
    expect(surfaceSource).toContain("goalStripOccupiesRow ? '-top-[2.375rem]' : 'top-0'")
    // 让位的只是纵向：横向锚点与事件穿透模型不动（球本体才接事件）。
    expect(surfaceSource).toContain(
      "'pointer-events-none absolute right-4 z-10 -translate-y-[80%] transition-[top]'",
    )
  })

  it('上移量与条的几何保持同步（条高 2rem + 下边距 0.375rem = 2.375rem）', () => {
    // 改 goal-workflow.css 的条高度/边距时，这里会先红，提醒同步吉祥物偏移。
    expect(goalCss).toContain('height: 2rem;')
    expect(goalCss).toContain('margin: 0 auto 0.375rem;')
    expect(surfaceSource).toContain('-top-[2.375rem]')
  })
})
