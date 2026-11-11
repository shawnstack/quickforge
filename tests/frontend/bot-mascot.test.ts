import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { MASCOT_DURATIONS, MASCOT_PALETTES } from '@/components/bots/mascot/mascot-geometry'
import { resolveMascotState, type MascotSignals } from '@/components/bots/mascot/mascot-state'

const css = readFileSync(
  new URL('../../src/components/bots/mascot/mascot-anim.css', import.meta.url),
  'utf8',
)
const strollCss = readFileSync(
  new URL('../../src/components/bots/mascot/mascot-stroll.css', import.meta.url),
  'utf8',
)
const componentSource = readFileSync(
  new URL('../../src/components/bots/mascot/BotMascot.tsx', import.meta.url),
  'utf8',
)

describe('resolveMascotState', () => {
  const base: MascotSignals = {}

  it('默认为待机', () => {
    expect(resolveMascotState(base)).toBe('idle')
  })

  it('正在输出 → 思考', () => {
    expect(resolveMascotState({ ...base, streaming: true })).toBe('thinking')
  })

  it('工具执行中压过流式状态 → 干活', () => {
    expect(resolveMascotState({ ...base, streaming: true, toolRunning: true })).toBe('working')
  })

  it('等审批/等回答压过一切运行态 → 提醒', () => {
    expect(resolveMascotState({ ...base, streaming: true, toolRunning: true, waitingForUser: true }))
      .toBe('alert')
  })

  it('出错优先级最高', () => {
    expect(resolveMascotState({ error: 'boom', waitingForUser: true, streaming: true })).toBe('alert')
  })

  it('刚完成 → 开心；心跳关掉 → 犯困', () => {
    expect(resolveMascotState({ justCompleted: true })).toBe('happy')
    expect(resolveMascotState({ paused: true })).toBe('sleepy')
  })

  it('空字符串错误不算出错', () => {
    expect(resolveMascotState({ error: '' })).toBe('idle')
  })
})

describe('吉祥物动画样式契约', () => {
  it('六个状态都有身体与左右眼的独立关键帧', () => {
    for (const state of Object.keys(MASCOT_DURATIONS)) {
      expect(css).toContain(`@keyframes qf-mascot-body-${state}`)
      expect(css).toContain(`@keyframes qf-mascot-eyeL-${state}`)
      expect(css).toContain(`@keyframes qf-mascot-eyeR-${state}`)
    }
  })

  it('每个状态的动画时长与几何数据一致', () => {
    for (const [state, seconds] of Object.entries(MASCOT_DURATIONS)) {
      expect(css).toContain(
        `.qf-mascot[data-state='${state}'] .qf-mascot__body { animation: qf-mascot-body-${state} ${seconds.toFixed(2)}s linear infinite; }`,
      )
    }
  })

  it('左右眼各有一套动画，能做对眼和分开', () => {
    for (const state of Object.keys(MASCOT_DURATIONS)) {
      expect(css).toContain(`.qf-mascot[data-state='${state}'] .qf-mascot__eye-l`)
      expect(css).toContain(`.qf-mascot[data-state='${state}'] .qf-mascot__eye-r`)
    }
  })

  it('减弱动效与「关掉动画」都停在静态姿态', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toContain('.qf-mascot--static')
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{[\s\S]*animation: none/)
  })

  it('弯月眼只在开心状态显示', () => {
    expect(css).toContain(".qf-mascot[data-state='happy'] .qf-mascot__arc { display: block; }")
    expect(css).toContain(".qf-mascot[data-state='happy'] .qf-mascot__eye { display: none; }")
  })
})

describe('尺寸下限：球径太小就看不出 squash & stretch', () => {
  // 画布 512 里球只占 300（余量留给跳跃、歪头），所以球径 = size × 300/512 = 58.6%。
  const BALL_RATIO = 300 / 512
  const ballDiameter = (source: string) => {
    const size = Number(/<BotMascot[\s\S]{0,600}?size=\{(\d+)\}/.exec(source)?.[1])
    expect(Number.isFinite(size), '没找到 BotMascot 的 size').toBe(true)
    return size * BALL_RATIO
  }

  it('输入框那只的球径不小于 56px（给过 64 → 37px，用户反馈「不如设计稿生动」）', () => {
    const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')
    expect(ballDiameter(appSource)).toBeGreaterThanOrEqual(56)
  })

  it('侧栏行首那只比原来的状态圆点大，但仍只当「在动」的指示（球径 < 20px）', () => {
    const listSource = readFileSync(
      new URL('../../src/components/bots/BotSidebarList.tsx', import.meta.url),
      'utf8',
    )
    const diameter = ballDiameter(listSource)
    expect(diameter).toBeGreaterThan(10)   // 18px 时球径只有 10.5px
    expect(diameter).toBeLessThan(20)      // 再大就把侧栏行撑高了
  })
})

describe('在输入框顶上溜达', () => {
  it('走路是可用的状态之一', () => {
    expect(Object.keys(MASCOT_DURATIONS)).toContain('walk')
    expect(css).toContain('@keyframes qf-mascot-body-walk')
  })

  it('溜达是横向位移，而且只播一次（什么时候播由 useMascotStroll 决定）', () => {
    expect(strollCss).toContain('@keyframes qf-mascot-stroll')
    expect(strollCss).toContain('translateX')
    expect(strollCss).toMatch(/animation: qf-mascot-stroll 9s ease-in-out 1;/)
    // 曾经的写法是 9s 无限循环，bot 只要闲着就一直左右晃
    expect(strollCss).not.toContain('infinite')
  })

  it('减弱动效时溜达也停', () => {
    expect(strollCss).toMatch(/prefers-reduced-motion: reduce\)\s*\{[\s\S]*animation: none/)
  })

  it('空闲不再被强行切成走路，只有散步窗口里才演 walk', () => {
    const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')
    expect(appSource).not.toContain("mascotState === 'idle' ? 'walk'")
    expect(appSource).toContain('useMascotStroll(botMode && mascotState')
    expect(appSource).toContain("state={mascotStrolling ? 'walk' : mascotState}")
    expect(appSource).toContain('stroll={mascotStrolling}')
  })

  it('两次散步之间留了能看得见的安静期，且刷新后不用干等', () => {
    const hookSource = readFileSync(
      new URL('../../src/components/bots/mascot/use-mascot-stroll.ts', import.meta.url),
      'utf8',
    )
    expect(hookSource).toContain('MASCOT_STROLL_GAP_MS = 20_000')
    expect(hookSource).toContain('MASCOT_STROLL_DURATION_MS = 9_000')
    expect(hookSource).toContain('MASCOT_STROLL_FIRST_DELAY_MS = 2_500')
    expect(hookSource).toContain('scheduleWalk(MASCOT_STROLL_FIRST_DELAY_MS)')
    // 不散步的原因不止一个：有状态、退出 bot 模式、系统要求减弱动效
    expect(hookSource).toContain('prefers-reduced-motion: reduce')
  })

  it('传了 stroll 就常驻包裹层，只切 data 属性；关掉动画时不溜达', () => {
    expect(componentSource).toContain("className=\"qf-mascot-stroll\"")
    expect(componentSource).toContain("data-strolling={stroll && animated ? 'true' : 'false'}")
    // 条件渲染会让 SVG 在走完那一刻重挂载，动画从 0% 重来
    expect(componentSource).not.toContain('if (!stroll) return svg')
    expect(componentSource).toContain('if (stroll === undefined) return svg')
  })
})

describe('BotMascot 组件', () => {
  it('把状态挂成 data-state，并支持静态开关', () => {
    expect(componentSource).toContain('data-state={state}')
    expect(componentSource).toContain("'qf-mascot--static'")
  })

  it('颜色走 CSS 变量，换色不需要重新生成素材', () => {
    expect(componentSource).toContain("'--qf-mascot-body': body")
    expect(componentSource).toContain("'--qf-mascot-eye': eye")
    expect(componentSource).toContain('fill="var(--qf-mascot-body)"')
    expect(componentSource).toContain('fill="var(--qf-mascot-eye)"')
  })

  it('渲染几何来自生成数据，而不是手抄数字', () => {
    expect(componentSource).toContain('MASCOT_BODY_SHAPE')
    expect(componentSource).toContain('MASCOT_EYE_SHAPE')
    expect(componentSource).toContain('MASCOT_ARC')
  })

  it('预设配色覆盖八套，且都带两色', () => {
    expect(MASCOT_PALETTES).toHaveLength(8)
    for (const palette of MASCOT_PALETTES) {
      expect(palette.body).toMatch(/^#[0-9A-F]{6}$/)
      expect(palette.eye).toMatch(/^#[0-9A-F]{6}$/)
    }
  })
})
