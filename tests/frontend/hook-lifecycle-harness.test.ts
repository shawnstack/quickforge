import { expect, it } from 'vitest'
import { HookLifecycle, hookRuntime } from './helpers/hook-lifecycle'

it('commits cleanup for every changed effect before setting up any replacement', () => {
  const lifecycle = new HookLifecycle()
  const calls: string[] = []
  const render = (version: number) => lifecycle.render(() => {
    for (const name of ['first', 'second']) hookRuntime.useEffect(() => {
      calls.push(`setup:${name}:${version}`)
      return () => { calls.push(`cleanup:${name}:${version}`) }
    }, [version])
  })
  render(1)
  expect(calls).toEqual(['setup:first:1', 'setup:second:1'])
  calls.length = 0
  render(1)
  expect(calls).toEqual([])
  render(2)
  expect(calls).toEqual(['cleanup:first:1', 'cleanup:second:1', 'setup:first:2', 'setup:second:2'])
  calls.length = 0
  lifecycle.unmount()
  lifecycle.unmount()
  expect(calls).toEqual(['cleanup:first:2', 'cleanup:second:2'])
})

it('retains setter, ref and callback identity across explicit rerenders', () => {
  const lifecycle = new HookLifecycle()
  const render = () => lifecycle.render(() => {
    const [count, setCount] = hookRuntime.useState(0)
    const ref = hookRuntime.useRef(0)
    const increment = hookRuntime.useCallback(() => setCount((value) => value + 1), [setCount])
    return { count, setCount, ref, increment }
  })
  const first = render()
  first.increment()
  const second = render()
  expect(second.count).toBe(1)
  expect(second.setCount).toBe(first.setCount)
  expect(second.ref).toBe(first.ref)
  expect(second.increment).toBe(first.increment)
  lifecycle.unmount()
})
