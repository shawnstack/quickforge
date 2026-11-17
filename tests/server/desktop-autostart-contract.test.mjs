import { describe, expect, it } from 'vitest'
import {
  AUTOSTART_HIDDEN_ARGUMENT,
  buildLoginItemQuery,
  buildLoginItemSettings,
  isAutostartSupported,
  parseAutostartRequest,
  resolveLoginItemPath,
  shouldStartHidden,
} from '../../desktop/autostart-contract.mjs'

describe('desktop autostart IPC contract', () => {
  it('accepts only the two whitelisted requests', () => {
    expect(parseAutostartRequest({ type: 'get-state' })).toEqual({ type: 'get-state' })
    expect(parseAutostartRequest({ type: 'set-enabled', enabled: true })).toEqual({ type: 'set-enabled', enabled: true })
    expect(parseAutostartRequest({ type: 'set-enabled', enabled: false })).toEqual({ type: 'set-enabled', enabled: false })
  })

  it('never lets the renderer choose what gets started at login', () => {
    // 白名单之外的任何字段都必须整条丢弃：path/args 一旦能从渲染进程传进来，
    // 就等于把「让任意程序开机自启」的能力交给页面。
    expect(parseAutostartRequest({ type: 'set-enabled', enabled: true, path: 'C:\\evil.exe' })).toBeNull()
    expect(parseAutostartRequest({ type: 'set-enabled', enabled: true, args: ['--x'] })).toBeNull()
    expect(parseAutostartRequest({ type: 'get-state', path: 'C:\\evil.exe' })).toBeNull()
    expect(parseAutostartRequest({ type: 'set-enabled' })).toBeNull()
    expect(parseAutostartRequest({ type: 'set-enabled', enabled: 'yes' })).toBeNull()
    expect(parseAutostartRequest({ type: 'open', enabled: true })).toBeNull()
    expect(parseAutostartRequest(null)).toBeNull()
    expect(parseAutostartRequest([])).toBeNull()
    expect(parseAutostartRequest('get-state')).toBeNull()
  })
})

describe('desktop autostart login item parameters', () => {
  it('supports only the platforms where Electron can read and write a login item', () => {
    expect(isAutostartSupported('win32')).toBe(true)
    expect(isAutostartSupported('darwin')).toBe(true)
    expect(isAutostartSupported('linux')).toBe(false)
  })

  it('prefers the portable launcher over the throwaway unpacked path', () => {
    // portable 版每次启动都解包到新的临时目录，写进登录项后下次开机就失效。
    expect(resolveLoginItemPath({
      executablePath: 'C:\\Users\\me\\AppData\\Local\\Temp\\2b93\\QuickForge.exe',
      portableExecutableFile: 'D:\\Apps\\QuickForge-Portable.exe',
    })).toBe('D:\\Apps\\QuickForge-Portable.exe')
    expect(resolveLoginItemPath({ executablePath: 'C:\\App\\QuickForge.exe', portableExecutableFile: '' }))
      .toBe('C:\\App\\QuickForge.exe')
    expect(resolveLoginItemPath({})).toBe('')
  })

  it('writes the hidden-launch argument on Windows and reads back with the exact same parameters', () => {
    const executablePath = 'C:\\App\\QuickForge.exe'
    const written = buildLoginItemSettings({ enabled: true, platform: 'win32', executablePath })
    expect(written).toEqual({ openAtLogin: true, path: executablePath, args: [AUTOSTART_HIDDEN_ARGUMENT] })

    // Electron 在 Windows 上按 path + args 匹配注册表项：读的时候用默认参数（path=execPath、
    // args=[]）永远匹配不到带 --hidden 的那一条，开关会点完自己弹回去。
    const query = buildLoginItemQuery({ platform: 'win32', executablePath })
    expect(query).toEqual({ path: written.path, args: written.args })
  })

  it('keeps path and args when disabling so the same entry is removed', () => {
    const executablePath = 'C:\\App\\QuickForge.exe'
    const removed = buildLoginItemSettings({ enabled: false, platform: 'win32', executablePath })
    expect(removed).toEqual({ openAtLogin: false, path: executablePath, args: [AUTOSTART_HIDDEN_ARGUMENT] })
  })

  it('uses the plain login-item flag on macOS', () => {
    expect(buildLoginItemSettings({ enabled: true, platform: 'darwin', executablePath: '/Applications/QuickForge.app' }))
      .toEqual({ openAtLogin: true })
    expect(buildLoginItemQuery({ platform: 'darwin', executablePath: '/Applications/QuickForge.app' })).toEqual({})
  })
})

describe('desktop autostart startup visibility', () => {
  it('stays in the tray when the login item launched it with the hidden argument', () => {
    expect(shouldStartHidden({ platform: 'win32', argv: ['QuickForge.exe', AUTOSTART_HIDDEN_ARGUMENT] })).toBe(true)
  })

  it('does not trust the Windows login-item flag for visibility', () => {
    // wasOpenedAtLogin 只有 macOS 有意义；Windows 上它可能为 true（进程由登录项拉起），
    // 但判断依据必须是命令行参数，否则手动双击也会被吞成「静默启动」。
    expect(shouldStartHidden({
      platform: 'win32',
      argv: ['QuickForge.exe'],
      loginItemSettings: { wasOpenedAtLogin: true },
    })).toBe(false)
  })

  it('reads wasOpenedAtLogin on macOS', () => {
    expect(shouldStartHidden({
      platform: 'darwin',
      argv: ['/Applications/QuickForge.app/Contents/MacOS/QuickForge'],
      loginItemSettings: { wasOpenedAtLogin: true },
    })).toBe(true)
    expect(shouldStartHidden({ platform: 'darwin', argv: [], loginItemSettings: { wasOpenedAtLogin: false } })).toBe(false)
    expect(shouldStartHidden({})).toBe(false)
  })
})
