import { beforeEach, describe, expect, it } from 'vitest'
import {
  INITIAL_UPDATE_CHECK_RESULT,
  useUpdateCheckStore,
} from '../../src/stores/update-check-store'

describe('updateCheckStore', () => {
  beforeEach(() => {
    useUpdateCheckStore.setState({ result: INITIAL_UPDATE_CHECK_RESULT })
  })

  it('初始 result 为 idle 且不提示更新', () => {
    expect(useUpdateCheckStore.getState().result).toEqual({ status: 'idle', updateAvailable: false })
  })

  it('setResult 兼容函数式更新（checking → done 流转）与直接赋值', () => {
    // 启动检查语义：保留其余字段，仅切换 status
    useUpdateCheckStore.getState().setResult((prev) => ({ ...prev, status: 'checking' }))
    expect(useUpdateCheckStore.getState().result.status).toBe('checking')

    useUpdateCheckStore.getState().setResult({
      status: 'done',
      currentVersion: '1.0.0',
      latestVersion: '1.1.0',
      updateAvailable: true,
    })
    expect(useUpdateCheckStore.getState().result).toEqual({
      status: 'done',
      currentVersion: '1.0.0',
      latestVersion: '1.1.0',
      updateAvailable: true,
    })

    // 失败语义：保留版本字段，仅置 error
    useUpdateCheckStore.getState().setResult((prev) => ({ ...prev, status: 'error' }))
    expect(useUpdateCheckStore.getState().result).toMatchObject({ status: 'error', latestVersion: '1.1.0' })
  })

  it('setResult 支持 dismiss 语义：仅关闭提示，保留版本信息', () => {
    useUpdateCheckStore.getState().setResult({
      status: 'done',
      currentVersion: '1.0.0',
      latestVersion: '1.1.0',
      updateAvailable: true,
    })

    useUpdateCheckStore.getState().setResult((prev) => ({ ...prev, updateAvailable: false }))

    const { result } = useUpdateCheckStore.getState()
    expect(result.updateAvailable).toBe(false)
    expect(result.latestVersion).toBe('1.1.0')
  })

  it('action 引用恒定，非 React 代码可经 getState() 直接调用', () => {
    const { setResult } = useUpdateCheckStore.getState()
    setResult((prev) => ({ ...prev, status: 'error' }))

    expect(useUpdateCheckStore.getState().result.status).toBe('error')
    expect(useUpdateCheckStore.getState().setResult).toBe(setResult)
  })
})
