const CHANNEL_EVENTS_URL_ENV = 'QUICKFORGE_CHANNEL_EVENTS_URL'
const CHANNEL_EVENT_ACTION = 'channel-event'
const RELAY_TIMEOUT_MS = 3000

export async function publishChannelSessionChanged(event) {
  const url = process.env[CHANNEL_EVENTS_URL_ENV]
  if (!url) return false

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), RELAY_TIMEOUT_MS)
  timer.unref?.()

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-quickforge-action': CHANNEL_EVENT_ACTION,
      },
      body: JSON.stringify({
        ...event,
        type: 'sessions-changed',
        timestamp: event.timestamp || new Date().toISOString(),
      }),
      signal: controller.signal,
    })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
