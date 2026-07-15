import { createExternalAppEnv, createVSCodeOpenArgs, shouldHideVSCodeLauncherWindow } from '../../../server/utils/platform.mjs'

describe('external application environment', () => {
  it('removes Electron runtime flags before launching VS Code', () => {
    const source = {
      ELECTRON_RUN_AS_NODE: '1',
      ELECTRON_NO_ATTACH_CONSOLE: '1',
      ATOM_SHELL_INTERNAL_RUN_AS_NODE: '1',
      PATH: 'example-path',
      QUICKFORGE_PORT: '5176',
    }

    expect(createExternalAppEnv(source)).toEqual({
      PATH: 'example-path',
      QUICKFORGE_PORT: '5176',
    })
    expect(source.ELECTRON_RUN_AS_NODE).toBe('1')
  })

  it('reuses the existing VS Code window on Windows', () => {
    expect(createVSCodeOpenArgs('D:\\quickforge', 'win32')).toEqual(['--reuse-window', 'D:\\quickforge'])
    expect(createVSCodeOpenArgs('/workspace', 'linux')).toEqual(['/workspace'])
  })

  it('only hides the Windows command fallback launcher', () => {
    expect(shouldHideVSCodeLauncherWindow('cmd.exe', 'win32')).toBe(true)
    expect(shouldHideVSCodeLauncherWindow('C:\\Windows\\System32\\cmd.exe', 'win32')).toBe(true)
    expect(shouldHideVSCodeLauncherWindow('C:\\Users\\example\\Code.exe', 'win32')).toBe(false)
    expect(shouldHideVSCodeLauncherWindow('code', 'linux')).toBe(false)
  })
})
