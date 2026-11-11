const CACHE_NAME = 'quickforge-pwa-v3'
const PRECACHE_URLS = [
  '/',
  '/favicon.svg',
  '/manifest.webmanifest',
  '/pwa-icon-192.png',
  '/pwa-icon-512.png',
  '/pwa-maskable-512.png',
]
const STATIC_DESTINATIONS = new Set(['script', 'style', 'image', 'font', 'manifest'])

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith('quickforge-pwa-') && cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName)),
      ))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const sessionId = event.notification.data?.sessionId
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(async (windowClients) => {
        const client = windowClients.find((candidate) => new URL(candidate.url).origin === self.location.origin)
        if (client) {
          await client.focus()
          client.postMessage({ type: 'quickforge:open-session', sessionId })
          return
        }
        await self.clients.openWindow('/')
      }),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  if (request.method !== 'GET') return
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api')) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request))
    return
  }

  // /assets/* 是带内容 hash 的构建产物：URL 变了就是新文件，同 URL 内容永不改。
  // 旧策略对它们用 stale-while-revalidate，构建后第一次访问永远回旧的，纯亏。
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request))
    return
  }

  if (STATIC_DESTINATIONS.has(request.destination)) {
    event.respondWith(staleWhileRevalidate(request))
  }
})

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME)

  try {
    // cache: 'reload' —— index.html 不吃浏览器 HTTP 缓存。
    // 它引用的是带 hash 的资产 URL，拿到新的 index 就等于拿到整套新前端。
    const response = await fetch(request, { cache: 'reload' })
    if (response.ok) {
      cache.put(request, response.clone())
    }
    return response
  } catch (_error) {
    const cachedResponse = await cache.match(request)
    return cachedResponse || cache.match('/')
  }
}

/** 带 hash 的构建产物：同一 URL 永远是同一份内容，命中缓存直接用，一年都不怕旧。 */
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME)
  const cachedResponse = await cache.match(request)
  if (cachedResponse) return cachedResponse

  const response = await fetch(request)
  if (response.ok) {
    cache.put(request, response.clone())
  }
  return response
}

self.addEventListener('message', (event) => {
  // 页面发现新版本 SW 已安装完，让它立刻接管，不用等所有标签页关闭。
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME)
  const cachedResponse = await cache.match(request)

  const networkResponsePromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone())
      }
      return response
    })
    .catch(() => undefined)

  return cachedResponse || networkResponsePromise
}
