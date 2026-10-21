import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getActiveSessionView,
  isInsideHiddenView,
  isSessionViewActive,
  resetSessionViewActivity,
  setActiveSessionView,
  subscribeSessionViewActivity,
} from '../../src/lib/session-view-activity'

afterEach(() => {
  resetSessionViewActivity()
})

describe('session view activity signal', () => {
  it('notifies the outgoing view before the incoming one', () => {
    const order: string[] = []
    subscribeSessionViewActivity('a', (active) => order.push(`a:${active}`))
    subscribeSessionViewActivity('b', (active) => order.push(`b:${active}`))

    setActiveSessionView('a')
    order.length = 0
    setActiveSessionView('b')

    expect(order).toEqual(['a:false', 'b:true'])
  })

  it('ignores repeated activation of the same view', () => {
    const listener = vi.fn()
    subscribeSessionViewActivity('a', listener)
    setActiveSessionView('a')
    setActiveSessionView('a')
    setActiveSessionView('a')

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(true)
  })

  it('tracks the current key', () => {
    expect(getActiveSessionView()).toBeNull()
    setActiveSessionView('a')
    expect(getActiveSessionView()).toBe('a')
    expect(isSessionViewActive('a')).toBe(true)
    expect(isSessionViewActive('b')).toBe(false)
  })

  it('deactivates the current view when set to null', () => {
    const listener = vi.fn()
    subscribeSessionViewActivity('a', listener)
    setActiveSessionView('a')
    setActiveSessionView(null)

    expect(listener).toHaveBeenLastCalledWith(false)
    expect(getActiveSessionView()).toBeNull()
  })

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeSessionViewActivity('a', listener)
    setActiveSessionView('a')
    unsubscribe()
    setActiveSessionView('b')

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('keeps notifying the other subscribers when one throws', () => {
    const survived = vi.fn()
    subscribeSessionViewActivity('a', () => { throw new Error('boom') })
    subscribeSessionViewActivity('a', survived)

    // A throwing listener must not abort a session switch mid-flight.
    expect(() => setActiveSessionView('a')).not.toThrow()
    expect(survived).toHaveBeenCalledWith(true)
  })

  it('does not call back on subscribe', () => {
    const listener = vi.fn()
    setActiveSessionView('a')
    subscribeSessionViewActivity('a', listener)

    expect(listener).not.toHaveBeenCalled()
  })
})

describe('hidden view detection', () => {
  // jsdom is available in this suite? No DOM here, so use a minimal stand-in:
  // `closest` is the only DOM API the helper depends on.
  function fakeElement(matches: Element | null) {
    return { closest: () => matches } as unknown as Element
  }

  it('reports an element inside a kept wrapper as hidden', () => {
    expect(isInsideHiddenView(fakeElement({} as Element))).toBe(true)
  })

  it('reports an element with no kept wrapper as visible', () => {
    expect(isInsideHiddenView(fakeElement(null))).toBe(false)
  })

  it('treats a missing element as visible', () => {
    // A detached/absent container must not silently disable the tail write.
    expect(isInsideHiddenView(null)).toBe(false)
  })
})
