import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProcessChannelProvider } from '../../../server/channels/process-channel.mjs'

class TestChannelProvider extends ProcessChannelProvider {
  buildStartCommand() {
    throw new Error('not used')
  }
}

describe('ProcessChannelProvider log persistence', () => {
  let logsDir

  beforeEach(async () => {
    logsDir = await mkdtemp(path.join(os.tmpdir(), 'quickforge-channel-log-'))
  })

  afterEach(async () => {
    await rm(logsDir, { recursive: true, force: true })
  })

  it('keeps in-memory events and appends UTF-8 channel logs by day', async () => {
    const provider = new TestChannelProvider({ id: 'test/channel', name: 'Test', description: 'Test' }, { logsDir })
    const received = []
    provider.on('event', (event) => received.push(event))

    provider.addLog('stdout', '你好\nworld')
    provider.addLog('stderr', 'failure')
    await provider.logWritePromise

    expect(provider.logs).toHaveLength(2)
    expect(received.filter((event) => event.type === 'log')).toHaveLength(2)

    const date = provider.logs[0].time.slice(0, 10)
    const content = await readFile(path.join(logsDir, 'channels', 'test-channel', `channel-${date}.log`), 'utf8')
    const entries = content.trim().split('\n').map((line) => JSON.parse(line))
    expect(entries).toEqual([
      { time: provider.logs[0].time, stream: 'stdout', text: '你好\nworld' },
      { time: provider.logs[1].time, stream: 'stderr', text: 'failure' },
    ])
  })
})
