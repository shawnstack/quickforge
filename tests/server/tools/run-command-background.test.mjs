import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { abortRunningCommand, toolReadFile, toolRunCommand } from '../../../server/tools/index.mjs'

const tempDirs = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {})))
})

describe('run_command background execution', () => {
  it('returns immediately, keeps writing the output file, and notifies when the process exits', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'quickforge-bg-'))
    tempDirs.push(cwd)
    const script = "setTimeout(() => { process.stdout.write('started-done'); process.exit(0) }, 250)"
    let notification = null

    const startedAt = Date.now()
    const result = await toolRunCommand({
      command: `node -e ${JSON.stringify(script)}`,
      description: 'background probe',
      run_in_background: true,
      timeoutMs: 1000,
    }, {
      workspaceRoot: cwd,
      sessionId: 'session-background',
      onBackgroundCommandExit: (value) => {
        notification = value
      },
    }, {
      toolCallId: 'tool-background',
      onBackgroundExit: (value) => {
        notification = value
      },
    })
    const returnedIn = Date.now() - startedAt

    expect(returnedIn).toBeLessThan(1000)
    expect(result.details).toMatchObject({
      running: true,
      background: true,
      detached: true,
      toolCallId: 'tool-background',
      timeoutMs: null,
    })
    expect(result.details.taskId).toMatch(/^task_/)
    expect(result.details.outputFile).toMatch(/commands[\\/].+\.log$/)
    expect(result.content).toContain(result.details.outputFile)
    expect(result.content).toContain('task-notification')

    const exited = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('background command did not exit')), 5000)
      const poll = () => {
        if (notification?.phase !== 'exit') {
          setTimeout(poll, 25)
          return
        }
        clearTimeout(timer)
        resolve(notification)
      }
      poll()
    })

    expect(exited).toMatchObject({
      taskId: result.details.taskId,
      sessionId: 'session-background',
      toolCallId: 'tool-background',
      outputFile: result.details.outputFile,
    })
    expect(exited.text).toContain('<task-notification>')
    expect(exited.text).toContain(result.details.outputFile)
    const log = await readFile(result.details.outputFile, 'utf8')
    expect(log).toContain('started-done')
    expect(log).toContain('Command finished.')

    const readBack = await toolReadFile({ path: result.details.outputFile })
    expect(readBack.content).toContain('started-done')
    expect(readBack.details.commandLog).toBe(true)
  })

  it('stops a detached command through the existing tool-call abort', async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), 'quickforge-bg-stop-'))
    tempDirs.push(cwd)
    let notification = null
    const result = await toolRunCommand({
      command: 'node -e "setInterval(() => {}, 1000)"',
      run_in_background: true,
    }, { workspaceRoot: cwd, sessionId: 'session-stop' }, {
      toolCallId: 'tool-stop',
      onBackgroundExit: (value) => {
        notification = value
      },
    })

    expect(abortRunningCommand('tool-stop')).toBe(true)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('stopped command did not notify')), 5000)
      const poll = () => {
        if (notification?.phase !== 'exit') {
          setTimeout(poll, 25)
          return
        }
        clearTimeout(timer)
        resolve()
      }
      poll()
    })
    expect(notification.details).toMatchObject({ taskId: result.details.taskId, status: 'aborted' })
  })
})
