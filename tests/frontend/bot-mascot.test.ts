import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  MASCOT_DURATIONS,
  MASCOT_EYE_SHAPE,
  MASCOT_PALETTES,
} from '@/components/bots/mascot/mascot-geometry'
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
  it('每个状态都有身体动画；有眼睛动作的状态左右眼共用一套', () => {
    for (const state of Object.keys(MASCOT_DURATIONS)) {
      expect(css).toContain(`@keyframes qf-mascot-body-${state}`)
    }
    // 开心（弯月眼）和走路两态眼睛不动，与设计稿一致
    for (const state of ['idle', 'thinking', 'working', 'sleepy', 'alert']) {
      expect(css).toContain(`@keyframes qf-mascot-eye-${state}`)
      expect(css).toContain(`.qf-mascot[data-state='${state}'] .qf-mascot__eye-l,`)
      expect(css).toContain(`.qf-mascot[data-state='${state}'] .qf-mascot__eye-r {`)
    }
  })

  it('每个状态的动画时长与几何数据一致', () => {
    for (const [state, seconds] of Object.entries(MASCOT_DURATIONS)) {
      expect(css).toContain(
        `.qf-mascot[data-state='${state}'] .qf-mascot__body { animation: qf-mascot-body-${state} ${seconds.toFixed(2)}s `,
      )
    }
  })

  it('动作与设计稿 mascot-v3.html 一致：球心为变换原点、原样缓动、不再分小尺寸增强版', () => {
    expect(css).toContain('.qf-mascot__body { transform-box: view-box; transform-origin: 256px 258px; }')
    expect(css).toContain('qf-mascot-body-idle 1.60s ease-in-out infinite')
    expect(css).toContain('qf-mascot-body-happy 0.90s cubic-bezier(.3,0,.2,1) infinite')
    expect(css).toContain('50%       { transform: translateY(-30px) scale(0.92, 1.10); }')
    expect(css).toContain('38%       { transform: translateY(-68px) scale(0.86, 1.16); }')
    expect(css).not.toContain('-small')
    expect(css).not.toContain('data-size')
    expect(componentSource).not.toContain('data-size')
  })

  it('默认墨黑配色在深色主题下换成白身黑眼', () => {
    expect(css).toContain(".dark .qf-mascot[data-look='default'] { --qf-mascot-body: #FFFFFF; --qf-mascot-eye: #0B0B0C; }")
    expect(componentSource).toContain("data-look={isDefaultLook ? 'default' : undefined}")
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

  it('输入框那只的球径不小于 46px（给过 64 → 37px，用户反馈「不如设计稿生动」）', () => {
    const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')
    // 46px 是「10% 的压扁拉伸 ≈ 4.6px」的下限；再小就只剩抖动。
    // 上界由用户的眼睛定：104（球径 61px）被否过「太大了」，别往那个方向加。
    expect(ballDiameter(appSource)).toBeGreaterThanOrEqual(46)
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

describe('互动动作（hover / poke / dizzy）', () => {
  it('互动关键帧与绑定规则齐全，全部挂在 data-interact 上', () => {
    for (const name of [
      'body-hover', 'eye-hover', 'body-hover-exit', 'eye-hover-exit',
      'body-poke', 'eye-poke', 'body-dizzy', 'dizzy-eye-l', 'dizzy-eye-r',
    ]) {
      expect(css).toContain(`@keyframes qf-mascot-${name}`)
    }
    expect(css).toContain("[data-interact='hover'] .qf-mascot__body { animation: qf-mascot-body-hover 0.45s ease-out forwards; }")
    expect(css).toContain("[data-interact='poke'] .qf-mascot__body { animation: qf-mascot-body-poke 0.60s cubic-bezier(.3,0,.4,1) 1; }")
    expect(css).toContain("[data-interact='dizzy'] .qf-mascot__eye-l { animation: qf-mascot-dizzy-eye-l 1.50s linear 1; }")
  })

  it('互动规则写在状态规则之后（同特异度，靠顺序在互动期间盖住状态动画）', () => {
    expect(css.indexOf("[data-interact='hover'] .qf-mascot__body")).toBeGreaterThan(
      css.indexOf("[data-state='idle'] .qf-mascot__body"),
    )
  })

  it('事件只挂在球本体上（空白处穿透）；减弱动效时互动也停', () => {
    expect(css).toContain('.qf-mascot.qf-mascot--interactive { pointer-events: none; }')
    expect(css).toContain('.qf-mascot.qf-mascot--interactive .qf-mascot__ball { pointer-events: auto; cursor: pointer; }')
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{[\s\S]*\[data-interact\] \.qf-mascot__body[\s\S]*animation: none/)
  })

  it('组件只在允许的状态（待机/犯困）响应互动，事件挂在球上', () => {
    expect(componentSource).toContain('MASCOT_INTERACTIVE_STATES.includes(state)')
    expect(componentSource).toContain('Boolean(interactive) && animated')
    expect(componentSource).toContain("data-interact={interact ?? undefined}")
    expect(componentSource).toContain("interactive && 'qf-mascot--interactive'")
    expect(componentSource).toContain('className="qf-mascot__ball"')
    expect(componentSource).toContain('{...(interactive ? handlers : {})}')
  })

  it('互动只给输入框上方那只；侧栏行和设置预览不加', () => {
    const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')
    expect(appSource).toMatch(/<BotMascot[\s\S]{0,900}?interactive/)
    const listSource = readFileSync(
      new URL('../../src/components/bots/BotSidebarList.tsx', import.meta.url),
      'utf8',
    )
    expect(listSource).not.toContain('interactive')
    const dialogsSource = readFileSync(
      new URL('../../src/components/bots/BotDialogs.tsx', import.meta.url),
      'utf8',
    )
    expect(dialogsSource).not.toContain('interactive')
  })
})

describe('表情增强：豆豆眼 / 东张西望 / 状态小符号', () => {
  it('眼型是验收定稿的豆豆眼：18×32，位置上移到 262', () => {
    // 三个尺寸（输入框 79 / 侧栏 24 / 设置预览 44）共用这一份几何数据，全局生效。
    expect(MASCOT_EYE_SHAPE).toEqual({ dx: 46, cy: 262, rx: 18, ry: 32 })
  })

  it('张望挂在 data-ambient 上：一次性 3.3s，只动 tilt/gaze 两个附加层', () => {
    for (const name of ['tilt-look', 'gaze-look', 'quest-look']) {
      expect(css).toContain(`@keyframes qf-mascot-${name}`)
    }
    expect(css).toContain(
      "[data-ambient='look'] .qf-mascot__tilt { animation: qf-mascot-tilt-look 3.30s ease-in-out 1; }",
    )
    expect(css).toContain(
      "[data-ambient='look'] .qf-mascot__gaze { animation: qf-mascot-gaze-look 3.30s ease-in-out 1; }",
    )
  })

  it('八个状态符号的关键帧与绑定齐全（… zZ !! ♡ 汗滴 ! 星星 ?）', () => {
    for (const name of [
      'sym-dot', 'sym-z', 'sym-bang', 'sym-heart', 'sym-sweat', 'sym-poke', 'sym-star-orbit',
    ]) {
      expect(css).toContain(`@keyframes qf-mascot-${name}`)
    }
    expect(css).toContain('.qf-mascot__sym { display: none; }')
    expect(css).toContain("[data-state='thinking'] .qf-mascot__sym-dots")
    expect(css).toContain("[data-state='sleepy'] .qf-mascot__sym-zz")
    expect(css).toContain("[data-state='alert'] .qf-mascot__sym-bang")
    expect(css).toContain("[data-state='happy'] .qf-mascot__sym-heart")
    expect(css).toContain("[data-state='working'] .qf-mascot__sym-sweat")
    expect(css).toContain("[data-interact='poke'] .qf-mascot__sym-poke")
    expect(css).toContain("[data-interact='dizzy'] .qf-mascot__sym-dizzy")
    expect(css).toContain("[data-ambient='look'] .qf-mascot__sym-quest")
  })

  it('符号与张望遵守「关掉动画」和「减弱动效」', () => {
    expect(css).toContain(
      '.qf-mascot.qf-mascot--static .qf-mascot__sym { display: none !important; }',
    )
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{[\s\S]*\.qf-mascot__sym \* \{ animation: none/)
  })

  it('组件：tilt/gaze 常驻（普通图层不动画），符号只在开互动且开动画的那只上渲染', () => {
    expect(componentSource).toContain('qf-mascot__tilt')
    expect(componentSource).toContain('qf-mascot__gaze')
    expect(componentSource).toContain('MASCOT_LOOK_STATES.includes(state)')
    expect(componentSource).toContain('data-ambient={ambient ?? undefined}')
    expect(componentSource).toContain('const showSymbols = Boolean(interactive) && animated')
    expect(componentSource).toContain('{showSymbols && (')
    // 配色规则：符号用球身色、汗滴用眼色（组件里眼色 fill 只该有两处：眼睛 + 汗滴）
    expect(componentSource.match(/fill="var\(--qf-mascot-eye\)"/g)).toHaveLength(2)
  })
})
