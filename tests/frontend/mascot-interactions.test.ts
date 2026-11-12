import { describe, expect, it } from 'vitest'
import {
  MASCOT_DIZZY_CLICKS,
  MASCOT_DIZZY_MS,
  MASCOT_DIZZY_WINDOW_MS,
  MASCOT_HOVER_EXIT_MS,
  MASCOT_LOOK_GAP_MAX_MS,
  MASCOT_LOOK_GAP_MIN_MS,
  MASCOT_LOOK_MS,
  MASCOT_LOOK_STATES,
  MASCOT_POKE_MS,
  MASCOT_SURPRISE_CLICKS,
  MASCOT_SURPRISE_MS,
  createMascotInteractController,
  type MascotAmbient,
  type MascotInteract,
} from '@/components/bots/mascot/mascot-interactions'

/** 假时钟：schedule/cancel/now 全部注入，advance 时按到期顺序执行回调。 */
function createEnv() {
  let now = 0
  let seq = 1
  const tasks = new Map<number, { at: number; fn: () => void }>()
  return {
    now: () => now,
    schedule: (fn: () => void, ms: number) => {
      const handle = seq
      seq += 1
      tasks.set(handle, { at: now + ms, fn })
      return handle
    },
    cancel: (handle: number) => {
      tasks.delete(handle)
    },
    advance(ms: number) {
      const target = now + ms
      for (;;) {
        let next: [number, { at: number; fn: () => void }] | undefined
        for (const entry of [...tasks.entries()]) {
          if (entry[1].at <= target && (!next || entry[1].at < next[1].at)) next = entry
        }
        if (!next) break
        now = Math.max(now, next[1].at)
        tasks.delete(next[0])
        next[1].fn()
      }
      now = target
    },
  }
}

function setup(enabled = true, random: () => number = () => 0) {
  const env = createEnv()
  const values: Array<MascotInteract | null> = []
  const ambients: Array<MascotAmbient | null> = []
  const controller = createMascotInteractController((value) => values.push(value), {
    schedule: env.schedule,
    cancel: env.cancel,
    now: env.now,
    random,
    enabled,
    setAmbient: (value) => ambients.push(value),
  })
  return {
    env,
    values,
    ambients,
    controller,
    last: () => values[values.length - 1] ?? null,
    lastAmbient: () => ambients[ambients.length - 1] ?? null,
  }
}

describe('createMascotInteractController', () => {
  it('悬停：进入 → hover，移开 → hover-exit，320ms 后归位', () => {
    const { env, controller, last } = setup()
    controller.onPointerEnter()
    expect(last()).toBe('hover')
    controller.onPointerLeave()
    expect(last()).toBe('hover-exit')
    env.advance(MASCOT_HOVER_EXIT_MS)
    expect(last()).toBeNull()
  })

  it('悬停退出没走完又回来：取消收尾，直接回 hover', () => {
    const { env, controller, last } = setup()
    controller.onPointerEnter()
    controller.onPointerLeave()
    env.advance(MASCOT_HOVER_EXIT_MS / 2)
    controller.onPointerEnter()
    expect(last()).toBe('hover')
    env.advance(MASCOT_HOVER_EXIT_MS)
    expect(last()).toBe('hover')
  })

  it('点击：poke 播完归位；指针还停在球上则回到 hover', () => {
    const a = setup()
    a.controller.onPointerDown()
    expect(a.last()).toBe('poke')
    a.env.advance(MASCOT_POKE_MS)
    expect(a.last()).toBeNull()

    const b = setup()
    b.controller.onPointerEnter()
    b.controller.onPointerDown()
    b.env.advance(MASCOT_POKE_MS)
    expect(b.last()).toBe('hover')
  })

  it('连点梯度完整链路：1 击 poke → 3 击 surprise → 5 击 dizzy（播放中的点击只计数）', () => {
    const { env, controller, last } = setup()
    controller.onPointerDown() // 第 1 下 → poke
    expect(last()).toBe('poke')
    env.advance(350)
    controller.onPointerDown() // 第 2 下：poke 播放中，只计数
    expect(last()).toBe('poke')
    env.advance(350) // poke 已播完
    controller.onPointerDown() // 第 3 下 → surprise
    expect(last()).toBe('surprise')
    env.advance(350)
    controller.onPointerDown() // 第 4 下：surprise 播放中，只计数
    expect(last()).toBe('surprise')
    controller.onPointerDown() // 第 5 下 → dizzy，打断 surprise
    expect(last()).toBe('dizzy')
    expect(MASCOT_DIZZY_CLICKS).toBe(5)
    env.advance(MASCOT_DIZZY_MS)
    expect(last()).toBeNull()
  })

  it('转晕播放中的点击被忽略', () => {
    const { env, controller, last, values } = setup()
    for (let i = 0; i < MASCOT_DIZZY_CLICKS; i += 1) {
      controller.onPointerDown()
      env.advance(10)
    }
    expect(last()).toBe('dizzy')
    const count = values.length
    controller.onPointerDown()
    expect(values.length).toBe(count) // 没产生任何新值
    expect(last()).toBe('dizzy')
    env.advance(MASCOT_DIZZY_MS)
    expect(last()).toBeNull()
  })

  it('慢速点击攒不满窗口，不会误触发 surprise / dizzy', () => {
    const { env, controller, last } = setup()
    // 每 800ms 一下来回点：1600ms 窗口内最多同时存在 2 下，到不了 3（surprise）更到不了 5（dizzy）
    for (let i = 0; i < 6; i += 1) {
      controller.onPointerDown()
      expect(last()).toBe('poke')
      env.advance(MASCOT_POKE_MS)
      expect(last()).toBeNull()
      env.advance(800 - MASCOT_POKE_MS)
    }
    expect(MASCOT_DIZZY_WINDOW_MS).toBe(1600)
  })

  it('连点梯度：快连 3 下升级成 surprise，播完归位', () => {
    const { env, controller, last } = setup()
    controller.onPointerDown() // 第 1 下 → poke（0.6s）
    expect(last()).toBe('poke')
    env.advance(650) // poke 播完
    controller.onPointerDown() // 第 2 下：又是一个 poke（上一轮计数还在窗口内）
    expect(last()).toBe('poke')
    env.advance(650)
    controller.onPointerDown() // 第 3 下（窗口 1600ms 内）→ surprise
    expect(last()).toBe('surprise')
    env.advance(MASCOT_SURPRISE_MS)
    expect(last()).toBeNull()
  })

  it('surprise 播放中的点击只计数，攒满 5 下打断成 dizzy', () => {
    const { env, controller, last } = setup()
    controller.onPointerDown() // t=0 第 1 下 → poke
    env.advance(650)          // poke 播完，计数还在窗口内
    controller.onPointerDown() // t=650 第 2 下 → poke
    env.advance(650)
    controller.onPointerDown() // t=1300 第 3 下 → surprise
    expect(last()).toBe('surprise')
    controller.onPointerDown() // t=1300 第 4 下：surprise 播放中，只计数
    expect(last()).toBe('surprise')
    controller.onPointerDown() // t=1300 第 5 下 → dizzy（打断 surprise）
    expect(last()).toBe('dizzy')
    env.advance(MASCOT_DIZZY_MS)
    expect(last()).toBeNull()
  })

  it('慢速点击（两击间隔远）不会误触发 surprise', () => {
    const { env, controller, last } = setup()
    controller.onPointerDown()
    env.advance(800)
    controller.onPointerDown() // 与第 1 下隔 800ms，仍在窗口内但只有 2 下
    expect(last()).toBe('poke')
    env.advance(800)
    controller.onPointerDown() // 第 1 下已出 1600ms 窗口，这是新一轮第 1 下
    expect(last()).toBe('poke')
    expect(MASCOT_SURPRISE_CLICKS).toBe(3)
  })

  it('关掉响应后指针事件无效，reset 清空已挂上的互动', () => {
    const { controller, last, values } = setup()
    controller.onPointerEnter()
    expect(last()).toBe('hover')
    controller.setEnabled(false)
    const count = values.length
    controller.onPointerDown()
    controller.onPointerLeave()
    expect(values.length).toBe(count)
    expect(last()).toBe('hover')
    controller.reset()
    expect(last()).toBeNull()
  })

  it('默认（enabled=false）时事件全部无效', () => {
    const { controller, last } = setup(false)
    controller.onPointerEnter()
    controller.onPointerDown()
    expect(last()).toBeNull()
  })
})

describe('东张西望（data-ambient=look）', () => {
  it('张望只有待机会来（犯困在打瞌睡），一段 3.3s、间隔随机 5~9s', () => {
    expect(MASCOT_LOOK_STATES).toEqual(['idle'])
    expect(MASCOT_LOOK_MS).toBe(3300)
    expect(MASCOT_LOOK_GAP_MIN_MS).toBe(5000)
    expect(MASCOT_LOOK_GAP_MAX_MS).toBe(9000)
  })

  it('待机时按间隔来一段，播完自动清掉、再约下一段', () => {
    const { env, lastAmbient, controller } = setup()
    controller.setAmbientEnabled(true)
    env.advance(MASCOT_LOOK_GAP_MIN_MS)
    expect(lastAmbient()).toBe('look')
    env.advance(MASCOT_LOOK_MS)
    expect(lastAmbient()).toBeNull()
    env.advance(MASCOT_LOOK_GAP_MIN_MS) // 下一段也到点了
    expect(lastAmbient()).toBe('look')
  })

  it('间隔随机落在 [5s, 9s]：两端都不是更早触发', () => {
    const min = setup(true, () => 0)
    min.controller.setAmbientEnabled(true)
    min.env.advance(MASCOT_LOOK_GAP_MIN_MS - 1)
    expect(min.lastAmbient()).toBeNull()
    min.env.advance(1)
    expect(min.lastAmbient()).toBe('look')

    const max = setup(true, () => 1)
    max.controller.setAmbientEnabled(true)
    max.env.advance(MASCOT_LOOK_GAP_MAX_MS - 1)
    expect(max.lastAmbient()).toBeNull()
    max.env.advance(1)
    expect(max.lastAmbient()).toBe('look')
  })

  it('悬停立即打断张望；悬停期间不张望，移开后从新间隔继续', () => {
    const { env, last, lastAmbient, controller } = setup()
    controller.setAmbientEnabled(true)
    env.advance(MASCOT_LOOK_GAP_MIN_MS)
    expect(lastAmbient()).toBe('look')
    controller.onPointerEnter()
    expect(lastAmbient()).toBeNull()
    expect(last()).toBe('hover')
    env.advance(MASCOT_LOOK_GAP_MIN_MS) // 悬停期间到点：不张望
    expect(lastAmbient()).toBeNull()
    controller.onPointerLeave()
    env.advance(MASCOT_HOVER_EXIT_MS + MASCOT_LOOK_GAP_MIN_MS)
    expect(lastAmbient()).toBe('look')
  })

  it('点击打断张望去演 poke', () => {
    const { env, last, lastAmbient, controller } = setup()
    controller.setAmbientEnabled(true)
    env.advance(MASCOT_LOOK_GAP_MIN_MS)
    expect(lastAmbient()).toBe('look')
    controller.onPointerDown()
    expect(lastAmbient()).toBeNull()
    expect(last()).toBe('poke')
    env.advance(MASCOT_POKE_MS)
    expect(last()).toBeNull()
  })

  it('关掉张望：立刻清掉并不再排期；互动开关关着（忙状态/走路）也到点不张望', () => {
    const off = setup()
    off.controller.setAmbientEnabled(true)
    off.env.advance(MASCOT_LOOK_GAP_MIN_MS)
    expect(off.lastAmbient()).toBe('look')
    off.controller.setAmbientEnabled(false)
    expect(off.lastAmbient()).toBeNull()
    off.env.advance(MASCOT_LOOK_GAP_MAX_MS * 2)
    expect(off.lastAmbient()).toBeNull()

    const busy = setup(false)
    busy.controller.setAmbientEnabled(true)
    busy.env.advance(MASCOT_LOOK_GAP_MAX_MS)
    expect(busy.lastAmbient()).toBeNull()
  })
})
