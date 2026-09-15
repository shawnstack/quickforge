import { spawn } from 'node:child_process'

export function killProcessTree(child) {
  if (!child?.pid) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    killer.on('error', () => {
      try { child.kill('SIGKILL') } catch { /* ignore */ }
    })
    return
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    try { child.kill('SIGKILL') } catch { /* ignore */ }
  }
}

export function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'ABORT_ERR'
}

// 客户端断开（req aborted / res 提前 close）时联动 AbortController；结算后必须调用 dispose 移除监听
export function createRequestAbortState(req, res) {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  const onClose = () => {
    if (!res.writableEnded) onAbort()
  }
  req?.once?.('aborted', onAbort)
  res?.once?.('close', onClose)
  return {
    signal: controller.signal,
    dispose: () => {
      req?.off?.('aborted', onAbort)
      res?.off?.('close', onClose)
    },
  }
}
