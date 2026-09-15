import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { channelLogsDirectory } from '../../../server/channels/channel-logs.mjs'

describe('channelLogsDirectory', () => {
  it('replaces runs of unsupported characters with a single hyphen', () => {
    const logsDir = path.resolve('var', 'logs')
    expect(channelLogsDirectory(logsDir, 'My Channel!')).toBe(path.join(logsDir, 'channels', 'My-Channel'))
    expect(channelLogsDirectory(logsDir, 'build && deploy')).toBe(path.join(logsDir, 'channels', 'build-deploy'))
  })

  it('trims leading and trailing hyphens', () => {
    expect(channelLogsDirectory(path.resolve('var', 'logs'), '--edge--'))
      .toBe(path.join(path.resolve('var', 'logs'), 'channels', 'edge'))
  })

  it('falls back to the generic channel id for empty or fully sanitized ids', () => {
    const logsDir = path.resolve('var', 'logs')
    for (const channelId of ['', null, undefined, '!@#$', '..', '频道']) {
      expect(channelLogsDirectory(logsDir, channelId)).toBe(path.join(logsDir, 'channels', 'channel'))
    }
  })

  it('sanitizes path-injection attempts down to their safe tail', () => {
    expect(channelLogsDirectory(path.resolve('var', 'logs'), '../inject'))
      .toBe(path.join(path.resolve('var', 'logs'), 'channels', 'inject'))
  })

  it('keeps supported characters untouched', () => {
    const logsDir = path.resolve('var', 'logs')
    expect(channelLogsDirectory(logsDir, 'Channel_1-x'))
      .toBe(path.join(logsDir, 'channels', 'Channel_1-x'))
  })

  it('joins under the resolved logs directory', () => {
    expect(channelLogsDirectory(path.join('relative', 'logs'), 'demo'))
      .toBe(path.join(path.resolve('relative', 'logs'), 'channels', 'demo'))
  })
})
