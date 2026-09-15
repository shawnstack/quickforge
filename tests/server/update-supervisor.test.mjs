// npm and the detached server are in-process event mocks inside a preloaded
// Node child. No PATH shim, shell, npm install or actual server is executed.
import { describe, expect, it } from 'vitest'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { sleep, waitForFile, withSupervisorFixture } from './helpers/supervisor-fixture.mjs'

const packageName = 'quickforge'

function startUpdater(fixture, { serverCwd = fixture.tmpDir, ...mock } = {}) {
  return fixture.start('update-supervisor.mjs', [
    String(fixture.oldPid), packageName, '9.9.9', fixture.serverScript,
    serverCwd, fixture.logFile, '--port', '4321',
  ], { mock })
}

describe('update-supervisor script', () => {
  it('requests a global package install and detached restart when simulated npm succeeds', async () => {
    await withSupervisorFixture(async (fixture) => {
      const serverCwd = path.join(fixture.tmpDir, 'server-cwd')
      await mkdir(serverCwd)
      const updater = await startUpdater(fixture, { serverCwd })
      const result = await updater.wait()
      expect(result.code, result.stderr).toBe(0)
      const log = await readFile(fixture.logFile, 'utf8')
      expect(await fixture.readCalls()).toEqual([
        {
          command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
          args: ['install', '-g', `${packageName}@latest`],
          cwd: fixture.tmpDir, stdio: ['ignore', 'pipe', 'pipe'],
          shell: process.platform === 'win32', windowsHide: true,
        },
        {
          command: process.execPath, args: [fixture.serverScript, '--port', '4321'],
          cwd: serverCwd, detached: true, stdio: 'ignore', shell: false, windowsHide: true,
        },
      ])
      expect(log).toContain('QuickForge external updater started.')
      expect(log).toContain('target=quickforge@latest latest=9.9.9')
      expect(log).toContain('Old QuickForge process has exited.')
      expect(log).toContain('install -g quickforge@latest')
      expect(log).toContain('npm install completed successfully.')
      expect(log).toContain('QuickForge server spawned.')
      expect(await fixture.readRecord()).toEqual({
        noOpen: '1', restartedFromUpdate: '1', args: ['--port', '4321'], cwd: serverCwd,
      })
      expect(await readFile(fixture.unrefFile, 'utf8')).toBe('unref\n')
    })
  })

  it('propagates the npm failure exit code and does not restart the server', async () => {
    await withSupervisorFixture(async (fixture) => {
      const updater = await startUpdater(fixture, { npmExitCode: 7 })
      const result = await updater.wait()
      expect(result.code, result.stderr).toBe(7)
      const log = await readFile(fixture.logFile, 'utf8')
      expect(log).toContain('npm install failed. code=7')
      expect(log).not.toContain('npm install completed successfully.')
      expect(await fixture.readCalls()).toHaveLength(1)
      await expect(readFile(fixture.outputFile)).rejects.toMatchObject({ code: 'ENOENT' })
    })
  })

  it('handles a simulated npm spawn error without restarting the server', async () => {
    await withSupervisorFixture(async (fixture) => {
      const updater = await startUpdater(fixture, { npmError: true })
      const result = await updater.wait()
      expect(result.code, result.stderr).toBe(1)
      expect(await readFile(fixture.logFile, 'utf8')).toContain('Simulated npm spawn failure')
      expect(await fixture.readCalls()).toHaveLength(1)
      await expect(readFile(fixture.outputFile)).rejects.toMatchObject({ code: 'ENOENT' })
    })
  })

  it('waits for the old process to exit before requesting npm install', async () => {
    await withSupervisorFixture(async (fixture) => {
      await fixture.keepOldAlive()
      const updater = await startUpdater(fixture)
      await waitForFile(fixture.probeFile)
      await sleep(250)
      await expect(readFile(fixture.callsFile)).rejects.toMatchObject({ code: 'ENOENT' })
      await fixture.exitOld()
      const result = await updater.wait()
      expect(result.code, result.stderr).toBe(0)
      expect((await fixture.readRecord()).restartedFromUpdate).toBe('1')
      const log = await readFile(fixture.logFile, 'utf8')
      expect(log).toContain(`Waiting for old QuickForge process ${fixture.oldPid} to exit...`)
      expect(log).toContain('Old QuickForge process has exited.')
    })
  })

  it('stops a waiting updater before deleting its fixture on assertion failure', async () => {
    let directory
    let updater
    await expect(withSupervisorFixture(async (fixture) => {
      directory = fixture.tmpDir
      await fixture.keepOldAlive()
      updater = await startUpdater(fixture)
      await waitForFile(fixture.probeFile)
      throw new Error('Intentional assertion failure')
    })).rejects.toThrow('Intentional assertion failure')
    const result = await updater.wait()
    expect(result.code === 0 && result.signal === null).toBe(false)
    await expect(readFile(path.join(directory, 'fixture.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
