import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const mainSource = readFileSync(new URL('../../desktop/electron-main.mjs', import.meta.url), 'utf8')
const publicApiSource = readFileSync(new URL('../../server/public-api.mjs', import.meta.url), 'utf8')

describe('Desktop fork-by-default startup structure', () => {
  it('opts into the inline server only via QUICKFORGE_DESKTOP_INLINE=1', () => {
    expect(mainSource).toContain("const inline = process.env.QUICKFORGE_DESKTOP_INLINE === '1'")
    expect(mainSource).not.toContain("process.env.QUICKFORGE_DESKTOP_INLINE !== '0'")
  })

  it('keeps reuse and proxy-runtime wiring keyed on the inline flag', () => {
    expect(mainSource).toContain("reuseExisting: inline ? false : 'same-version'")
    expect(mainSource).toContain('networkRuntime: inline ? createDesktopNetworkRuntime() : undefined')
    expect(mainSource).toContain('inline,')
  })

  it('keeps server stderr visible in dev and silent in packaged builds', () => {
    expect(mainSource).toContain("stdio: app.isPackaged ? 'ignore' : 'inherit'")
  })

  it('escalates fork shutdown from SIGTERM to SIGKILL instead of fire-and-forget', () => {
    expect(publicApiSource).toContain('async function stopChildProcess(child)')
    expect(publicApiSource).toContain('child.kill(\'SIGTERM\')')
    expect(publicApiSource).toContain('child.kill(\'SIGKILL\')')
    expect(publicApiSource).toContain('const CHILD_STOP_SIGTERM_WAIT_MS = 10000')
    expect(publicApiSource).toMatch(/await waitForChildExit\(child, CHILD_STOP_SIGTERM_WAIT_MS\)/)
    expect(publicApiSource).toMatch(/await stopChildProcess\(child\)/)
    expect(publicApiSource).toMatch(/await stopChildProcess\(instance\.child\)/)
    expect(publicApiSource).not.toMatch(/child\.kill\('SIGTERM'\)\s*\n\s*return true/)
  })
})
