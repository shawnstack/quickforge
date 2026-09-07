import { createExternalAppEnv, createFileManagerOpenArgs, createVSCodeOpenArgs, shouldHideVSCodeLauncherWindow } from '../../../server/utils/platform.mjs'

describe('file manager open arguments', () => {
  it('opens directories directly on every platform', () => {
    expect(createFileManagerOpenArgs('C:\\cache\\global\\tmp\\conversations\\s1', true, 'win32'))
      .toEqual(['C:\\cache\\global\\tmp\\conversations\\s1'])
    expect(createFileManagerOpenArgs('/tmp/conversations/s1', true, 'darwin'))
      .toEqual(['/tmp/conversations/s1'])
    expect(createFileManagerOpenArgs('/tmp/conversations/s1', true, 'linux'))
      .toEqual(['/tmp/conversations/s1'])
  })

  it('reveals files at their location instead of rejecting them', () => {
    expect(createFileManagerOpenArgs('C:\\cache\\global\\tmp\\conversations\\s1\\pasted-content.txt', false, 'win32'))
      .toEqual(['/select,C:\\cache\\global\\tmp\\conversations\\s1\\pasted-content.txt'])
    expect(createFileManagerOpenArgs('/tmp/conversations/s1/pasted-content.txt', false, 'darwin'))
      .toEqual(['-R', '/tmp/conversations/s1/pasted-content.txt'])
    // Linux has no cross-desktop reveal standard: open the parent folder.
    expect(createFileManagerOpenArgs('/tmp/conversations/s1/pasted-content.txt', false, 'linux'))
      .toEqual(['/tmp/conversations/s1'])
  })
})

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
