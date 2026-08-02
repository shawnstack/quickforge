import { createNodeProcessEnv } from '../../../server/utils/process-env.mjs'

describe('Node child process environment', () => {
  it('adds Electron Node mode only for explicit child processes', () => {
    const source = {
      ELECTRON_RUN_AS_NODE: 'inherited',
      ATOM_SHELL_INTERNAL_RUN_AS_NODE: 'inherited',
      PATH: 'example-path',
    }

    expect(createNodeProcessEnv(source, { QUICKFORGE_NO_OPEN: '1' }, { electron: '39.2.7' })).toEqual({
      ELECTRON_RUN_AS_NODE: '1',
      PATH: 'example-path',
      QUICKFORGE_NO_OPEN: '1',
    })
    expect(source.ELECTRON_RUN_AS_NODE).toBe('inherited')
  })

  it('removes inherited Electron Node mode outside Electron', () => {
    expect(createNodeProcessEnv({
      ELECTRON_RUN_AS_NODE: '1',
      ATOM_SHELL_INTERNAL_RUN_AS_NODE: '1',
      PATH: 'example-path',
    }, {}, {})).toEqual({ PATH: 'example-path' })
  })
})
