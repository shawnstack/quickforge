import path from 'node:path'

function safeChannelId(channelId) {
  const safeId = String(channelId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return safeId || 'channel'
}

export function channelLogsDirectory(logsDir, channelId) {
  return path.join(path.resolve(logsDir), 'channels', safeChannelId(channelId))
}
