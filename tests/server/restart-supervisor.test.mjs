// Execute the top-level supervisor in a controlled Node child. Its preload
// simulates process probes and records spawn/unref, never launching a server.
import { describe, expect, it } from 'vitest'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { sleep, waitForFile, withSupervisorFixture } from './helpers/supervisor-fixture.mjs'

describe('restart-supervisor script', () => {
  it('spawns the server script detached with restart markers once the old process is gone', async () => {
    await withSupervisorFixture(async (fixture) => {
      const serverCwd = path.join(fixture.tmpDir, 'server-cwd')
      await mkdir(serverCwd)
      const supervisor = await fixture.start('restart-supervisor.mjs', [
        String(fixture.oldPid), fixture.serverScript, serverCwd, '--port', '1234',
      ])
      const result = await supervisor.wait()
      expect(result.code, result.stderr).toBe(0)
      expect(await fixture.readRecord()).toEqual({
        noOpen: '1', restartedFromUi: '1', args: ['--port', '1234'], cwd: serverCwd,
      })
      expect(await fixture.readCalls()).toEqual([{
        command: process.execPath,
        args: [fixture.serverScript, '--port', '1234'],
        cwd: serverCwd, detached: true, stdio: 'ignore', shell: false, windowsHide: true,
      }])
      expect(await readFile(fixture.unrefFile, 'utf8')).toBe('unref\n')
    })
  })

  it('waits for the old process to exit before spawning the server script', async () => {
    await withSupervisorFixture(async (fixture) => {
      await fixture.keepOldAlive()
      const supervisor = await fixture.start('restart-supervisor.mjs', [
        String(fixture.oldPid), fixture.serverScript, fixture.tmpDir,
      ])
      // Handshake ensures the supervisor actually reached the polling loop.
      await waitForFile(fixture.probeFile)
      await sleep(250)
      await expect(readFile(fixture.callsFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      await fixture.exitOld()
      const result = await supervisor.wait()
      expect(result.code, result.stderr).toBe(0)
      expect((await fixture.readRecord()).restartedFromUi).toBe('1')
    })
  })

  it('falls back to inheriting the supervisor cwd when no cwd argument is provided', async () => {
    await withSupervisorFixture(async (fixture) => {
      const supervisor = await fixture.start('restart-supervisor.mjs', [
        String(fixture.oldPid), fixture.serverScript,
      ])
      const result = await supervisor.wait()
      expect(result.code, result.stderr).toBe(0)
      const record = await fixture.readRecord()
      expect(record.cwd).toBe(fixture.tmpDir)
      expect(record.args).toEqual([])
    })
  })

  it('fails closed for an unexpected spawn target instead of executing it', async () => {
    await withSupervisorFixture(async (fixture) => {
      const supervisor = await fixture.start('restart-supervisor.mjs', [
        String(fixture.oldPid), path.join(fixture.tmpDir, 'unexpected.mjs'), fixture.tmpDir,
      ])
      const result = await supervisor.wait()
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('Real child process execution is forbidden')
      await expect(readFile(fixture.callsFile)).rejects.toMatchObject({ code: 'ENOENT' })
    })
  })

  it('kills and waits for the supervisor before removing fixtures when a test fails', async () => {
    let directory
    let supervisor
    await expect(withSupervisorFixture(async (fixture) => {
      directory = fixture.tmpDir
      await fixture.keepOldAlive()
      supervisor = await fixture.start('restart-supervisor.mjs', [
        String(fixture.oldPid), fixture.serverScript, fixture.tmpDir,
      ])
      await waitForFile(fixture.probeFile)
      throw new Error('Intentional assertion failure')
    })).rejects.toThrow('Intentional assertion failure')
    const result = await supervisor.wait()
    expect(result.code === 0 && result.signal === null).toBe(false)
    await expect(readFile(path.join(directory, 'fixture.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
