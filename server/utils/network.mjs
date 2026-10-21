import os from 'node:os'

export function isPrivateIpv4(hostname) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname || '')) return false
  const parts = hostname.split('.').map((part) => Number(part))
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b] = parts
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

export function isLoopbackAddress(address) {
  if (!address) return false
  const normalized = address.replace(/^::ffff:/, '')
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost'
}

export function getLanIpv4Addresses() {
  const result = []
  const seen = new Set()
  const interfaces = os.networkInterfaces()

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal) continue
      if (!isPrivateIpv4(entry.address)) continue
      if (seen.has(entry.address)) continue
      seen.add(entry.address)
      result.push(entry.address)
    }
  }

  return result
}

export function getLanUrls(port, protocol = 'http') {
  const safePort = Number(port)
  return getLanIpv4Addresses().map((address) => `${protocol}://${address}${safePort ? `:${safePort}` : ''}`)
}
