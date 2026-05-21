declare const __QUICKFORGE_SERVER_PORT__: string | undefined

export function getDirectBackendBaseUrl(): string {
  const serverPort = typeof __QUICKFORGE_SERVER_PORT__ !== 'undefined' ? __QUICKFORGE_SERVER_PORT__ : ''
  if (serverPort && serverPort !== location.port) {
    return `${location.protocol}//127.0.0.1:${serverPort}`
  }
  return ''
}

export function getWebSocketBaseUrl(): string {
  const directBase = getDirectBackendBaseUrl()
  if (directBase) {
    const url = new URL(directBase)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return url.toString().replace(/\/$/, '')
  }
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`
}
